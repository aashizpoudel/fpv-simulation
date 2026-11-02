//! Motor and battery calculations. This module has no WebAssembly-specific code.

use std::f64::consts::PI;

pub const ROTOR_COUNT: usize = 4;
const SECONDS_PER_HOUR: f64 = 3600.0;
// Simple reduction in available thrust as air flows into the propeller.
const AIRSPEED_LOSS_PER_MPS: f64 = 0.03;

/// Physical parameters for one motor and propeller. SI units are in field names.
#[derive(Clone, Copy, Debug)]
pub struct RotorConfig {
    pub kv_rpm_per_volt: f64,
    pub resistance_ohm: f64,
    pub no_load_current_amp: f64,
    pub max_current_amp: f64,
    pub inertia_kg_m2: f64,
    pub thrust_n_per_rpm2: f64,
    pub reaction_torque_nm_per_newton: f64,
    pub esc_time_constant_s: f64,
    /// Use -1 or +1 to describe the rotor's yaw reaction direction.
    pub spin_direction: f64,
}

impl RotorConfig {
    pub(crate) fn is_valid(self) -> bool {
        [
            self.kv_rpm_per_volt,
            self.resistance_ohm,
            self.max_current_amp,
            self.inertia_kg_m2,
            self.thrust_n_per_rpm2,
            self.esc_time_constant_s,
        ]
        .iter()
        .all(|value| *value > 0.0)
            && self.no_load_current_amp >= 0.0
            && self.reaction_torque_nm_per_newton >= 0.0
            && self.spin_direction != 0.0
    }
}

#[derive(Clone, Copy, Debug)]
pub struct BatteryConfig {
    pub capacity_ah: f64,
    pub initial_charge_fraction: f64,
    pub full_voltage: f64,
    pub empty_voltage: f64,
    pub internal_resistance_ohm: f64,
    pub max_sag_current_amp: f64,
    pub electronics_current_amp: f64,
    pub fixed_voltage: Option<f64>,
}

impl BatteryConfig {
    pub(crate) fn is_valid(self) -> bool {
        self.capacity_ah > 0.0
            && (0.0..=1.0).contains(&self.initial_charge_fraction)
            && self.full_voltage > 0.0
            && self.empty_voltage >= 0.0
            && self.internal_resistance_ohm >= 0.0
            && self.max_sag_current_amp >= 0.0
            && self.electronics_current_amp >= 0.0
    }

    fn voltage(self, charge_ah: f64, previous_current_amp: f64) -> f64 {
        if let Some(fixed) = self.fixed_voltage {
            return fixed;
        }
        let charge_fraction = (charge_ah / self.capacity_ah).clamp(0.0, 1.0);
        let open_circuit =
            self.empty_voltage + (self.full_voltage - self.empty_voltage) * charge_fraction;
        let sag = previous_current_amp.min(self.max_sag_current_amp) * self.internal_resistance_ohm;
        (open_circuit - sag).max(0.0)
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RotorState {
    pub rpm: f64,
    pub esc_duty: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RotorOutput {
    pub rpm: f64,
    pub thrust_n: f64,
    pub reaction_torque_nm: f64,
    pub current_amp: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct StepOutput {
    pub rotors: [RotorOutput; ROTOR_COUNT],
    pub battery_voltage: f64,
    pub battery_current_amp: f64,
    pub charge_fraction: f64,
    pub total_thrust_n: f64,
    pub yaw_reaction_torque_nm: f64,
}

/// Owns the changing state of the motors and battery between simulation ticks.
#[derive(Debug)]
pub struct MotorPlant {
    pub rotors: [RotorState; ROTOR_COUNT],
    pub charge_ah: f64,
    pub rotor_config: [RotorConfig; ROTOR_COUNT],
    pub battery_config: BatteryConfig,
    previous_current_amp: f64,
}

impl MotorPlant {
    pub fn new(rotor_config: [RotorConfig; ROTOR_COUNT], battery_config: BatteryConfig) -> Self {
        let mut plant = Self {
            rotors: [RotorState::default(); ROTOR_COUNT],
            charge_ah: 0.0,
            rotor_config,
            battery_config,
            previous_current_amp: 0.0,
        };
        plant.reset();
        plant
    }

    pub fn reset(&mut self) {
        self.rotors = [RotorState::default(); ROTOR_COUNT];
        self.charge_ah =
            self.battery_config.capacity_ah * self.battery_config.initial_charge_fraction;
        self.previous_current_amp = self.battery_config.electronics_current_amp;
    }

    /// Advance one tick. Commands are ESC duty fractions from 0 to 1.
    /// A nonpositive or nonfinite `dt_s` reads current output without advancing state.
    pub fn step(
        &mut self,
        commands: [f64; ROTOR_COUNT],
        axial_airspeed_mps: f64,
        armed: bool,
        dt_s: f64,
    ) -> StepOutput {
        let dt = if dt_s.is_finite() && dt_s > 0.0 {
            dt_s
        } else {
            0.0
        };
        let battery = self.battery_config;
        let voltage = battery.voltage(self.charge_ah, self.previous_current_amp);
        let mut output = StepOutput {
            rotors: [RotorOutput::default(); ROTOR_COUNT],
            battery_voltage: voltage,
            battery_current_amp: battery.electronics_current_amp,
            charge_fraction: self.charge_ah / battery.capacity_ah,
            total_thrust_n: 0.0,
            yaw_reaction_torque_nm: 0.0,
        };

        for (index, rotor_output) in output.rotors.iter_mut().enumerate() {
            let config = self.rotor_config[index];
            *rotor_output = advance_rotor(
                &mut self.rotors[index],
                config,
                commands[index],
                voltage,
                axial_airspeed_mps,
                armed,
                dt,
            );
            output.battery_current_amp += rotor_output.current_amp;
            output.total_thrust_n += rotor_output.thrust_n;
            output.yaw_reaction_torque_nm +=
                rotor_output.reaction_torque_nm * config.spin_direction.signum();
        }

        if dt > 0.0 {
            self.charge_ah =
                (self.charge_ah - output.battery_current_amp * dt / SECONDS_PER_HOUR).max(0.0);
            self.previous_current_amp = output.battery_current_amp;
        }
        output.charge_fraction = (self.charge_ah / battery.capacity_ah).clamp(0.0, 1.0);
        output
    }
}

fn advance_rotor(
    state: &mut RotorState,
    config: RotorConfig,
    command: f64,
    battery_voltage: f64,
    axial_airspeed_mps: f64,
    armed: bool,
    dt: f64,
) -> RotorOutput {
    let target_duty = if armed && command.is_finite() {
        command.clamp(0.0, 1.0)
    } else {
        0.0
    };
    if dt > 0.0 {
        // The ESC cannot jump to a new duty instantly.
        let response = 1.0 - (-dt / config.esc_time_constant_s).exp();
        state.esc_duty += (target_duty - state.esc_duty) * response;
    }

    let torque_per_amp = 60.0 / (2.0 * PI * config.kv_rpm_per_volt);
    let applied_voltage = battery_voltage * state.esc_duty;
    let back_emf_voltage = state.rpm / config.kv_rpm_per_volt;
    let winding_current = ((applied_voltage - back_emf_voltage) / config.resistance_ohm)
        .clamp(-config.max_current_amp, config.max_current_amp);
    let electric_torque = winding_current * torque_per_amp;
    let friction_torque = config.no_load_current_amp * torque_per_amp;
    let drive_torque = if state.rpm > 0.0 {
        electric_torque - friction_torque
    } else {
        (electric_torque - friction_torque).max(0.0)
    };

    let airspeed_factor =
        (1.0 - AIRSPEED_LOSS_PER_MPS * axial_airspeed_mps.max(0.0)).clamp(0.0, 1.0);
    let thrust_before = config.thrust_n_per_rpm2 * state.rpm.powi(2) * airspeed_factor;
    let propeller_load = thrust_before * config.reaction_torque_nm_per_newton;
    if dt > 0.0 {
        let angular_acceleration = (drive_torque - propeller_load) / config.inertia_kg_m2;
        let rpm_change = angular_acceleration * dt * 60.0 / (2.0 * PI);
        state.rpm = (state.rpm + rpm_change).max(0.0);
    }

    let thrust_n = config.thrust_n_per_rpm2 * state.rpm.powi(2) * airspeed_factor;
    RotorOutput {
        rpm: state.rpm,
        thrust_n,
        reaction_torque_nm: thrust_n * config.reaction_torque_nm_per_newton,
        // Regenerative braking slows the rotor, but does not draw battery current.
        current_amp: winding_current.max(0.0) * state.esc_duty,
    }
}
