//! Motor, propeller, and battery simulation for a four-rotor drone.
//!
//! JavaScript supplies the drone's configuration and motor commands. The
//! functions in `ffi` expose the resulting thrust and torque to WebAssembly.

mod ffi;
mod firmware;
mod model;

pub use firmware::BetaflightController;
pub use model::{BatteryConfig, MotorPlant, RotorConfig, RotorOutput, RotorState, StepOutput};

#[cfg(target_arch = "wasm32")]
mod sys_alloc {
    use std::alloc::{GlobalAlloc, Layout};

    struct EmscriptenAlloc;

    unsafe impl GlobalAlloc for EmscriptenAlloc {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            extern "C" {
                fn malloc(size: usize) -> *mut u8;
            }
            malloc(layout.size())
        }

        unsafe fn dealloc(&self, ptr: *mut u8, _layout: Layout) {
            extern "C" {
                fn free(ptr: *mut u8);
            }
            free(ptr);
        }
    }

    #[global_allocator]
    static ALLOC: EmscriptenAlloc = EmscriptenAlloc;
}

#[cfg(test)]
mod tests;
