//! Safe Rust wrapper for Betaflight flight controller HAL.

#[cfg(target_arch = "wasm32")]
extern "C" {
    fn bf_hal_init() -> i32;
    fn bf_hal_scheduler();
    fn bf_hal_advance_time(dt_us: u32);
    fn bf_hal_is_armed() -> bool;
    fn bf_hal_set_imu(gx: f32, gy: f32, gz: f32, ax: f32, ay: f32, az: f32);
    fn bf_hal_set_attitude_quat(w: f32, x: f32, y: f32, z: f32);
    fn bf_hal_set_rc(channels: *const f32);
    fn bf_hal_set_battery(sag: f32, unf: f32, amp: f32, mah: f32, cells: u8);
    fn bf_hal_get_motor_command(index: u8) -> f32;
    fn bf_hal_get_motor_pwm(index: u8) -> f32;
    fn bf_hal_serial_rx(port: i32, data: *const u8, len: i32) -> i32;
    fn bf_hal_serial_tx(port: i32, data: *mut u8, cap: i32) -> i32;
    fn bf_hal_serial_tx_dropped(port: i32) -> u32;
    fn bf_hal_set_eeprom_filename(filename: *const i8);
}

#[cfg(not(target_arch = "wasm32"))]
mod host_mock {
    pub(super) unsafe fn bf_hal_init() -> i32 { 1 }
    pub(super) unsafe fn bf_hal_scheduler() {}
    pub(super) unsafe fn bf_hal_advance_time(_dt_us: u32) {}
    pub(super) unsafe fn bf_hal_is_armed() -> bool { false }
    pub(super) unsafe fn bf_hal_set_imu(_gx: f32, _gy: f32, _gz: f32, _ax: f32, _ay: f32, _az: f32) {}
    pub(super) unsafe fn bf_hal_set_attitude_quat(_w: f32, _x: f32, _y: f32, _z: f32) {}
    pub(super) unsafe fn bf_hal_set_rc(_channels: *const f32) {}
    pub(super) unsafe fn bf_hal_set_battery(_sag: f32, _unf: f32, _amp: f32, _mah: f32, _cells: u8) {}
    pub(super) unsafe fn bf_hal_get_motor_command(_index: u8) -> f32 { 0.0 }
    pub(super) unsafe fn bf_hal_get_motor_pwm(_index: u8) -> f32 { 1000.0 }
    pub(super) unsafe fn bf_hal_serial_rx(_port: i32, _data: *const u8, _len: i32) -> i32 { 0 }
    pub(super) unsafe fn bf_hal_serial_tx(_port: i32, _data: *mut u8, _cap: i32) -> i32 { 0 }
    pub(super) unsafe fn bf_hal_serial_tx_dropped(_port: i32) -> u32 { 0 }
    pub(super) unsafe fn bf_hal_set_eeprom_filename(_filename: *const i8) {}
}

#[cfg(not(target_arch = "wasm32"))]
use host_mock::*;

pub struct BetaflightController {
    initialized: bool,
}

impl Default for BetaflightController {
    fn default() -> Self {
        Self::new()
    }
}

impl BetaflightController {
    pub fn new() -> Self {
        let ok = unsafe { bf_hal_init() };
        Self {
            initialized: ok != 0,
        }
    }

    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// Advance Betaflight by N settling ticks (for gyro calibration during boot).
    pub fn settle(&mut self, iterations: u32) {
        for _ in 0..iterations {
            unsafe {
                bf_hal_advance_time(1000);
                bf_hal_scheduler();
            }
        }
    }

    /// Step Betaflight with sensor inputs & RC stick commands.
    /// Returns the 4 normalized motor commands [0.0, 1.0].
    pub fn step(
        &mut self,
        rc: &[f32; 8],
        gyro: [f32; 3],
        acc: [f32; 3],
        quat: [f32; 4],
        dt: f64,
    ) -> [f64; 4] {
        let dt_us = (dt * 1e6) as u32;

        unsafe {
            bf_hal_advance_time(dt_us);
            bf_hal_set_imu(gyro[0], gyro[1], gyro[2], acc[0], acc[1], acc[2]);
            bf_hal_set_attitude_quat(quat[0], quat[1], quat[2], quat[3]);
            bf_hal_set_rc(rc.as_ptr());
            bf_hal_scheduler();
        }

        std::array::from_fn(|i| unsafe { bf_hal_get_motor_command(i as u8) as f64 })
    }

    pub fn is_armed(&self) -> bool {
        unsafe { bf_hal_is_armed() }
    }

    pub fn update_battery(&mut self, voltage: f64, current: f64, mah_drawn: f64) {
        unsafe {
            bf_hal_set_battery(
                voltage as f32,
                voltage as f32,
                current as f32,
                mah_drawn as f32,
                1,
            );
        }
    }

    pub fn motor_pwm(&self, index: u8) -> f32 {
        unsafe { bf_hal_get_motor_pwm(index) }
    }

    pub fn serial_rx(&mut self, port: i32, data: &[u8]) -> i32 {
        unsafe { bf_hal_serial_rx(port, data.as_ptr(), data.len() as i32) }
    }

    pub fn serial_tx(&mut self, port: i32, buffer: &mut [u8]) -> i32 {
        unsafe { bf_hal_serial_tx(port, buffer.as_mut_ptr(), buffer.len() as i32) }
    }

    pub fn serial_tx_dropped(&self, port: i32) -> u32 {
        unsafe { bf_hal_serial_tx_dropped(port) }
    }

    pub fn set_eeprom_filename(&mut self, name: *const i8) {
        unsafe { bf_hal_set_eeprom_filename(name) }
    }
}
