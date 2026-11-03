//! WebAssembly exports called by JavaScript. Keep pointer handling here so the
//! motor model can be read and tested like ordinary Rust code.

use crate::firmware::BetaflightController;
use crate::model::{BatteryConfig, MotorPlant, RotorConfig, StepOutput, ROTOR_COUNT};

pub(crate) const ROTOR_FIELDS: usize = 9;
const BATTERY_FIELDS: usize = 8;
pub(crate) const CONFIG_LEN: usize = ROTOR_COUNT * ROTOR_FIELDS + BATTERY_FIELDS;

/// Holds the latest output so JavaScript can read each value after a step.
pub struct DroneSim {
    plant: MotorPlant,
    latest: StepOutput,
    fc: BetaflightController,
    motor_commands: [f64; ROTOR_COUNT],
}

impl DroneSim {
    fn new(mut plant: MotorPlant) -> Self {
        let latest = plant.step([0.0; ROTOR_COUNT], 0.0, false, 0.0);
        let fc = BetaflightController::new();
        Self {
            plant,
            latest,
            fc,
            motor_commands: [0.0; ROTOR_COUNT],
        }
    }

    fn reset(&mut self) {
        self.fc.reset_flight_state();
        self.plant.reset();
        self.motor_commands = [0.0; ROTOR_COUNT];
        self.latest = self.plant.step([0.0; ROTOR_COUNT], 0.0, false, 0.0);
    }
}

/// Each rotor has: KV, resistance, no-load current, peak current, inertia,
/// thrust coefficient, torque coefficient, ESC response time, spin direction.
/// The final eight values describe the battery (see `parse_battery`).
fn parse_config(values: &[f64]) -> Option<MotorPlant> {
    if values.len() != CONFIG_LEN || values.iter().any(|value| !value.is_finite()) {
        return None;
    }
    let rotors = std::array::from_fn(|index| {
        let start = index * ROTOR_FIELDS;
        let r = &values[start..start + ROTOR_FIELDS];
        RotorConfig {
            kv_rpm_per_volt: r[0],
            resistance_ohm: r[1],
            no_load_current_amp: r[2],
            max_current_amp: r[3],
            inertia_kg_m2: r[4],
            thrust_n_per_rpm2: r[5],
            reaction_torque_nm_per_newton: r[6],
            esc_time_constant_s: r[7],
            spin_direction: r[8],
        }
    });
    if rotors.iter().any(|rotor| !rotor.is_valid()) {
        return None;
    }
    let battery_values = &values[ROTOR_COUNT * ROTOR_FIELDS..];
    let battery = parse_battery(battery_values);
    if !battery.is_valid() {
        return None;
    }
    Some(MotorPlant::new(rotors, battery))
}

/// Capacity (Ah), initial charge, full/empty voltage, resistance, maximum sag
/// current, electronics current, then fixed voltage (-1 means use discharge).
fn parse_battery(b: &[f64]) -> BatteryConfig {
    BatteryConfig {
        capacity_ah: b[0],
        initial_charge_fraction: b[1],
        full_voltage: b[2],
        empty_voltage: b[3],
        internal_resistance_ohm: b[4],
        max_sag_current_amp: b[5],
        electronics_current_amp: b[6],
        fixed_voltage: if b[7] >= 0.0 { Some(b[7]) } else { None },
    }
}

/// Report the number of f64 values JavaScript must write into the buffer.
#[no_mangle]
pub extern "C" fn dronesim_config_len() -> usize {
    CONFIG_LEN
}

/// Allocate the configuration buffer. JavaScript fills it, calls
/// `dronesim_init`, then releases it with `dronesim_config_free`.
#[no_mangle]
pub extern "C" fn dronesim_config_alloc() -> *mut f64 {
    Box::into_raw(Box::new([0.0; CONFIG_LEN])) as *mut f64
}

/// # Safety
/// `config` must be a pointer returned by `dronesim_config_alloc`, freed once.
#[no_mangle]
pub unsafe extern "C" fn dronesim_config_free(config: *mut f64) {
    if !config.is_null() {
        drop(Box::from_raw(config as *mut [f64; CONFIG_LEN]));
    }
}

/// # Safety
/// `config` must point to at least `length` readable f64 values in WASM memory.
/// This function copies the values; JavaScript still owns the buffer.
#[no_mangle]
pub unsafe extern "C" fn dronesim_init(config: *const f64, length: usize) -> *mut DroneSim {
    if config.is_null() || length != CONFIG_LEN {
        return std::ptr::null_mut();
    }
    let values = std::slice::from_raw_parts(config, length);
    match parse_config(values) {
        Some(plant) => Box::into_raw(Box::new(DroneSim::new(plant))),
        None => std::ptr::null_mut(),
    }
}

/// # Safety
/// `handle` must come from `dronesim_init` and be freed no more than once.
#[no_mangle]
pub unsafe extern "C" fn dronesim_free(handle: *mut DroneSim) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_reset(handle: *mut DroneSim) {
    if let Some(sim) = handle.as_mut() {
        sim.reset();
    }
}

/// Set the active Betaflight rate profile. Layout:
/// [rate type, roll/pitch/yaw RC rate, roll/pitch/yaw expo,
///  roll/pitch/yaw super rate], all in native Betaflight units.
/// Rate types: 0 Betaflight, 1 Raceflight, 2 KISS, 3 Actual, 4 Quick.
/// Returns 1 on success or 0 for invalid input.
/// # Safety
/// `handle` must be a live pointer from `dronesim_init`; `values` must point
/// to `length` readable bytes in WASM memory.
#[no_mangle]
pub unsafe extern "C" fn dronesim_set_rates(handle: *mut DroneSim, values: *const u8, length: usize) -> i32 {
    let Some(sim) = handle.as_mut() else { return 0 };
    if values.is_null() || length != 10 {
        return 0;
    }
    let data = std::slice::from_raw_parts(values, length);
    let rc_rates = [data[1], data[2], data[3]];
    let expo = [data[4], data[5], data[6]];
    let super_rates = [data[7], data[8], data[9]];
    i32::from(sim.fc.set_rates(data[0], rc_rates, expo, super_rates))
}

/// Set active Betaflight PID P/I/D values in native integer units.
/// Layout: [roll P,I,D, pitch P,I,D, yaw P,I,D]. Returns 0 while armed.
/// # Safety
/// `handle` must be a live pointer from `dronesim_init`; `values` must point
/// to `length` readable bytes in WASM memory.
#[no_mangle]
pub unsafe extern "C" fn dronesim_set_pid_rate_config(handle: *mut DroneSim, values: *const u8, length: usize) -> i32 {
    let Some(sim) = handle.as_mut() else { return 0 };
    if values.is_null() || length != 9 {
        return 0;
    }
    let data = std::slice::from_raw_parts(values, length);
    let mut pids = [0; 9];
    pids.copy_from_slice(data);
    i32::from(sim.fc.set_pid_rate_config(pids))
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_step(
    handle: *mut DroneSim,
    motor_0: f64,
    motor_1: f64,
    motor_2: f64,
    motor_3: f64,
    axial_airspeed_mps: f64,
    armed: i32,
    dt_s: f64,
) -> i32 {
    let Some(sim) = handle.as_mut() else { return 0 };
    let commands = [motor_0, motor_1, motor_2, motor_3];
    sim.latest = sim
        .plant
        .step(commands, axial_airspeed_mps, armed != 0, dt_s);
    1
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_thrust(handle: *const DroneSim, rotor: i32) -> f64 {
    handle
        .as_ref()
        .and_then(|sim| sim.latest.rotors.get(rotor as usize))
        .map_or(0.0, |output| output.thrust_n)
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_torque(handle: *const DroneSim, rotor: i32) -> f64 {
    handle
        .as_ref()
        .and_then(|sim| sim.latest.rotors.get(rotor as usize))
        .map_or(0.0, |output| output.reaction_torque_nm)
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_voltage(handle: *const DroneSim) -> f64 {
    handle
        .as_ref()
        .map_or(0.0, |sim| sim.latest.battery_voltage)
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_current(handle: *const DroneSim) -> f64 {
    handle
        .as_ref()
        .map_or(0.0, |sim| sim.latest.battery_current_amp)
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_charge(handle: *const DroneSim) -> f64 {
    handle
        .as_ref()
        .map_or(0.0, |sim| sim.latest.charge_fraction)
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_boot_settle(handle: *mut DroneSim, ticks: u32, _legacy_rc_channel_order: u32) -> i32 {
    let Some(sim) = handle.as_mut() else { return 0 };
    sim.fc.settle(ticks);
    1
}

fn flight_step_with_raw_rc(
    sim: &mut DroneSim,
    rc: [f32; 8],
    gyro: [f32; 3],
    acc: [f32; 3],
    quat: [f32; 4],
    axial_airspeed_mps: f64,
    dt_s: f64,
) -> i32 {
    // Betaflight interprets raw slots using the rcmap loaded from EEPROM.
    sim.motor_commands = sim.fc.step(&rc, gyro, acc, quat, dt_s);

    let armed = sim.fc.is_armed();
    sim.latest = sim
        .plant
        .step(sim.motor_commands, axial_airspeed_mps, armed, dt_s);

    let mah_drawn = (1.0 - sim.latest.charge_fraction) * sim.plant.battery_config.capacity_ah * 1000.0;
    sim.fc.update_battery(
        sim.latest.battery_voltage,
        sim.latest.battery_current_amp,
        mah_drawn,
    );

    1
}

/// Step with all eight normalized raw receiver slots in EEPROM channel order.
/// `rc_channels` must point to eight readable f32 values in WASM memory.
/// # Safety
/// `handle` must be a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_flight_step_raw(
    handle: *mut DroneSim,
    rc_channels: *const f32,
    rc_length: usize,
    gyro_x: f32,
    gyro_y: f32,
    gyro_z: f32,
    acc_x: f32,
    acc_y: f32,
    acc_z: f32,
    quat_w: f32,
    quat_x: f32,
    quat_y: f32,
    quat_z: f32,
    axial_airspeed_mps: f64,
    dt_s: f64,
) -> i32 {
    let Some(sim) = handle.as_mut() else { return 0 };
    if rc_channels.is_null() || rc_length != 8 {
        return 0;
    }
    let raw = std::slice::from_raw_parts(rc_channels, rc_length);
    if raw.iter().any(|value| !value.is_finite() || !(-1.0..=1.0).contains(value)) {
        return 0;
    }
    let mut rc = [0.0; 8];
    rc.copy_from_slice(raw);
    flight_step_with_raw_rc(
        sim, rc, [gyro_x, gyro_y, gyro_z], [acc_x, acc_y, acc_z],
        [quat_w, quat_x, quat_y, quat_z], axial_airspeed_mps, dt_s,
    )
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_flight_step(
    handle: *mut DroneSim,
    // Legacy six-slot ABI. Values are already in raw EEPROM receiver order.
    raw_rc_0: f32,
    raw_rc_1: f32,
    raw_rc_2: f32,
    raw_rc_3: f32,
    raw_rc_4: f32,
    raw_rc_5: f32,
    _legacy_rc_channel_order: u32,
    // Rigid body kinematics from physics:
    gyro_x: f32,
    gyro_y: f32,
    gyro_z: f32,
    acc_x: f32,
    acc_y: f32,
    acc_z: f32,
    quat_w: f32,
    quat_x: f32,
    quat_y: f32,
    quat_z: f32,
    axial_airspeed_mps: f64,
    dt_s: f64,
) -> i32 {
    let Some(sim) = handle.as_mut() else { return 0 };
    flight_step_with_raw_rc(
        sim, [raw_rc_0, raw_rc_1, raw_rc_2, raw_rc_3, raw_rc_4, raw_rc_5, -1.0, -1.0],
        [gyro_x, gyro_y, gyro_z], [acc_x, acc_y, acc_z],
        [quat_w, quat_x, quat_y, quat_z], axial_airspeed_mps, dt_s,
    )
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_is_armed(handle: *const DroneSim) -> i32 {
    handle.as_ref().map_or(0, |s| if s.fc.is_armed() { 1 } else { 0 })
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_motor_command(handle: *const DroneSim, rotor: i32) -> f64 {
    handle
        .as_ref()
        .and_then(|s| s.motor_commands.get(rotor as usize))
        .copied()
        .unwrap_or(0.0)
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_motor_pwm(handle: *const DroneSim, rotor: i32) -> f32 {
    handle
        .as_ref()
        .map_or(1000.0, |s| s.fc.motor_pwm(rotor as u8))
}

/// Push serial bytes to Betaflight UART RX (for MSP/Configurator).
/// # Safety
/// `handle` and `data` must be non-null and valid for `length` bytes.
#[no_mangle]
pub unsafe extern "C" fn dronesim_serial_push(
    handle: *mut DroneSim,
    port: i32,
    data: *const u8,
    length: usize,
) -> i32 {
    let Some(sim) = handle.as_mut() else { return -1 };
    if data.is_null() { return -1 };
    let slice = std::slice::from_raw_parts(data, length);
    sim.fc.serial_rx(port, slice)
}

/// Pull serial bytes from Betaflight UART TX (for MSP/Configurator).
/// # Safety
/// `handle` and `buffer` must be non-null and valid for `capacity` bytes.
#[no_mangle]
pub unsafe extern "C" fn dronesim_serial_pull(
    handle: *mut DroneSim,
    port: i32,
    buffer: *mut u8,
    capacity: usize,
) -> i32 {
    let Some(sim) = handle.as_mut() else { return -1 };
    if buffer.is_null() { return -1 };
    let slice = std::slice::from_raw_parts_mut(buffer, capacity);
    sim.fc.serial_tx(port, slice)
}
