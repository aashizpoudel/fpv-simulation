use crate::ffi::*;
use crate::model::*;

fn rotor_config(spin_direction: f64) -> RotorConfig {
    RotorConfig {
        kv_rpm_per_volt: 15_000.0,
        resistance_ohm: 0.38,
        no_load_current_amp: 0.0075,
        max_current_amp: 10.0,
        inertia_kg_m2: 3.75e-8,
        thrust_n_per_rpm2: 0.196 / (15_000.0_f64 * 3.8).powi(2),
        reaction_torque_nm_per_newton: 0.003,
        esc_time_constant_s: 0.002,
        spin_direction,
    }
}

fn battery_config() -> BatteryConfig {
    BatteryConfig {
        capacity_ah: 0.45,
        initial_charge_fraction: 1.0,
        full_voltage: 4.35,
        empty_voltage: 3.2,
        internal_resistance_ohm: 0.08,
        max_sag_current_amp: 10.0,
        electronics_current_amp: 0.2,
        fixed_voltage: None,
    }
}

fn plant() -> MotorPlant {
    MotorPlant::new(
        [
            rotor_config(-1.0),
            rotor_config(1.0),
            rotor_config(1.0),
            rotor_config(-1.0),
        ],
        battery_config(),
    )
}

/// The same flat format that JavaScript writes into WASM memory.
fn config_values() -> [f64; CONFIG_LEN] {
    let plant = plant();
    let mut values = [0.0; CONFIG_LEN];
    for (i, rotor) in plant.rotor_config.iter().enumerate() {
        let start = i * ROTOR_FIELDS;
        values[start..start + ROTOR_FIELDS].copy_from_slice(&[
            rotor.kv_rpm_per_volt,
            rotor.resistance_ohm,
            rotor.no_load_current_amp,
            rotor.max_current_amp,
            rotor.inertia_kg_m2,
            rotor.thrust_n_per_rpm2,
            rotor.reaction_torque_nm_per_newton,
            rotor.esc_time_constant_s,
            rotor.spin_direction,
        ]);
    }
    let b = plant.battery_config;
    values[4 * ROTOR_FIELDS..].copy_from_slice(&[
        b.capacity_ah,
        b.initial_charge_fraction,
        b.full_voltage,
        b.empty_voltage,
        b.internal_resistance_ohm,
        b.max_sag_current_amp,
        b.electronics_current_amp,
        -1.0,
    ]);
    values
}

#[test]
fn equal_commands_create_lift_without_yaw() {
    let mut plant = plant();
    let mut output = plant.step([0.0; 4], 0.0, false, 0.001);
    for _ in 0..2500 {
        output = plant.step([1.0; 4], 0.0, true, 0.001);
    }
    assert!(output.total_thrust_n > 0.044 * 9.81);
    assert!(output.yaw_reaction_torque_nm.abs() < 1e-12);
    assert!(output.battery_voltage < 4.35);
    assert!(output.charge_fraction < 1.0);
}

#[test]
fn disarming_spins_down_and_reset_restores_state() {
    let mut plant = plant();
    for _ in 0..200 {
        plant.step([1.0; 4], 0.0, true, 0.001);
    }
    let before = plant.rotors[0].rpm;
    for _ in 0..200 {
        plant.step([1.0; 4], 0.0, false, 0.001);
    }
    assert!(plant.rotors[0].rpm < before);
    assert!(plant.rotors.iter().all(|rotor| rotor.rpm >= 0.0));
    plant.reset();
    assert!(plant.rotors.iter().all(|rotor| rotor.rpm == 0.0));
    assert!((plant.charge_ah - 0.45).abs() < 1e-12);
}

#[test]
fn invalid_time_step_does_not_advance_motors_or_battery() {
    let mut plant = plant();
    let before = plant.charge_ah;
    let output = plant.step([1.0; 4], 0.0, true, f64::NAN);
    assert!(output.rotors.iter().all(|rotor| rotor.rpm == 0.0));
    assert_eq!(plant.charge_ah, before);
}

#[test]
fn init_rejects_bad_configuration() {
    let mut values = config_values();
    unsafe {
        assert!(dronesim_init(values.as_ptr(), values.len() - 1).is_null());
        values[0] = f64::NAN;
        assert!(dronesim_init(values.as_ptr(), values.len()).is_null());
        values[0] = 0.0;
        assert!(dronesim_init(values.as_ptr(), values.len()).is_null());
    }
}

#[test]
fn init_uses_the_supplied_rotor_and_battery_values() {
    let mut values = config_values();
    values[CONFIG_LEN - 1] = 3.6; // Fixed voltage from the caller.
    let normal = unsafe { dronesim_init(values.as_ptr(), values.len()) };
    values[5] *= 1.5; // More thrust from rotor zero.
    let stronger = unsafe { dronesim_init(values.as_ptr(), values.len()) };
    assert!(!normal.is_null() && !stronger.is_null());
    unsafe {
        for _ in 0..800 {
            dronesim_step(normal, 1.0, 1.0, 1.0, 1.0, 0.0, 1, 0.001);
            dronesim_step(stronger, 1.0, 1.0, 1.0, 1.0, 0.0, 1, 0.001);
        }
        assert!(dronesim_thrust(stronger, 0) > dronesim_thrust(normal, 0));
        assert_eq!(dronesim_voltage(normal), 3.6);
        assert!(dronesim_charge(normal) < 1.0);
        dronesim_reset(normal);
        assert_eq!(dronesim_charge(normal), 1.0);
        dronesim_free(normal);
        dronesim_free(stronger);
    }
}
