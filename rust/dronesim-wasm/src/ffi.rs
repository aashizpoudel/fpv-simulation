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
pub unsafe extern "C" fn dronesim_boot_settle(handle: *mut DroneSim, ticks: u32) -> i32 {
    let Some(sim) = handle.as_mut() else { return 0 };
    sim.fc.settle(ticks);
    1
}

/// # Safety
/// `handle` must be null or a live pointer returned by `dronesim_init`.
#[no_mangle]
pub unsafe extern "C" fn dronesim_flight_step(
    handle: *mut DroneSim,
    // RC stick inputs [-1.0, 1.0]:
    rc_roll: f32,
    rc_pitch: f32,
    rc_throttle: f32,
    rc_yaw: f32,
    rc_arm: f32,
    rc_mode: f32,
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

    let rc = [rc_roll, rc_pitch, rc_throttle, rc_yaw, rc_arm, rc_mode, -1.0, -1.0];
    let gyro = [gyro_x, gyro_y, gyro_z];
    let acc = [acc_x, acc_y, acc_z];
    let quat = [quat_w, quat_x, quat_y, quat_z];

    // 1. Betaflight computes motor commands:
    sim.motor_commands = sim.fc.step(&rc, gyro, acc, quat, dt_s);

    // 2. MotorPlant computes thrust, torque, and battery sag:
    let armed = sim.fc.is_armed();
    sim.latest = sim
        .plant
        .step(sim.motor_commands, axial_airspeed_mps, armed, dt_s);

    // 3. Feed battery state back to Betaflight:
    let mah_drawn = (1.0 - sim.latest.charge_fraction) * sim.plant.battery_config.capacity_ah * 1000.0;
    sim.fc.update_battery(
        sim.latest.battery_voltage,
        sim.latest.battery_current_amp,
        mah_drawn,
    );

    1
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
