//! Motor, propeller, and battery simulation for a four-rotor drone.
//!
//! JavaScript supplies the drone's configuration and motor commands. The
//! functions in `ffi` expose the resulting thrust and torque to WebAssembly.

mod ffi;
mod firmware;
mod model;

pub use firmware::BetaflightController;
pub use model::{BatteryConfig, MotorPlant, RotorConfig, RotorOutput, RotorState, StepOutput};

#[cfg(test)]
mod tests;
