#ifndef BF_HAL_H
#define BF_HAL_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// =============================================================================
// Lifecycle & Scheduler
// =============================================================================

/**
 * Initialize Betaflight subsystems, parameter groups, and virtual devices.
 * Returns 1 on success, 0 on failure.
 */
int bf_hal_init(void);

/**
 * Execute one iteration of the Betaflight task scheduler.
 */
void bf_hal_scheduler(void);

/**
 * Advance virtual monotonic time by delta microseconds (e.g. 1000 us for 1 kHz).
 */
void bf_hal_advance_time(uint32_t dt_us);

/**
 * Check if the flight controller is currently armed.
 */
bool bf_hal_is_armed(void);

/**
 * Disarm and clear controller state after a simulation reset.
 */
void bf_hal_reset_flight_state(void);

/**
 * Get bitmask of active arming disable flags (0 = arming permitted).
 */
uint32_t bf_hal_get_arming_disable_flags(void);

/**
 * Replace the active Betaflight rate profile's type and Roll/Pitch/Yaw values.
 * type: 0 Betaflight, 1 Raceflight, 2 KISS, 3 Actual, 4 Quick.
 * rc_rates, expo, and super_rates use native Betaflight integer units.
 * Returns 1 on success, 0 for an invalid type or out-of-range value.
 */
int bf_hal_set_rates(uint8_t type, const uint8_t rc_rates[3],
                     const uint8_t expo[3], const uint8_t super_rates[3]);

/**
 * Replace the active PID profile's Roll/Pitch/Yaw P, I, and D values.
 * pids is [roll P,I,D, pitch P,I,D, yaw P,I,D] in native Betaflight units.
 * Returns 1 on success, 0 if armed.
 */
int bf_hal_set_pid_rate_config(const uint8_t pids[9]);

/**
 * Set the EEPROM file path (or in-memory filename) for config persistence.
 */
void bf_hal_set_eeprom_filename(const char *filename);

// =============================================================================
// Sensor & Control Inputs (from Simulator -> Betaflight)
// =============================================================================

/**
 * Update virtual gyro rates (rad/s) and accelerometer forces (m/s^2).
 */
void bf_hal_set_imu(float gyro_x, float gyro_y, float gyro_z,
                    float acc_x, float acc_y, float acc_z);

/**
 * Optionally update the fused attitude quaternion directly [w, x, y, z].
 */
void bf_hal_set_attitude_quat(float w, float x, float y, float z);

/**
 * Set 8 normalized RC channel values in range [-1.0, 1.0].
 * Raw order follows the Betaflight rcmap loaded from EEPROM. The caller
 * arranges Roll, Pitch, Yaw, Throttle and AUX values into those eight slots.
 */
void bf_hal_set_rc(const float channels[8]);

/**
 * Update battery telemetry (volts, amps, mAh drawn, and detected cell count).
 */
void bf_hal_set_battery(float voltage_sag, float voltage_unfiltered,
                        float amperage, float mah_drawn, uint8_t cell_count);

// =============================================================================
// Actuator Outputs (from Betaflight -> Simulator)
// =============================================================================

/**
 * Get motor command for rotor index (0..3) normalized in [0.0, 1.0].
 */
float bf_hal_get_motor_command(uint8_t index);

/**
 * Get raw PWM/DShot output value for rotor index (0..3) (typically 1000..2000).
 */
float bf_hal_get_motor_pwm(uint8_t index);

// =============================================================================
// In-Memory Serial / MSP Bridge (Betaflight Configurator & Telemetry)
// =============================================================================

/**
 * Push raw serial bytes into the virtual UART RX ring buffer.
 * Returns number of bytes accepted.
 */
int bf_hal_serial_rx(int port_index, const uint8_t *data, int length);

/**
 * Pull outgoing serial bytes from the virtual UART TX ring buffer.
 * Returns number of bytes written into the output buffer.
 */
int bf_hal_serial_tx(int port_index, uint8_t *buffer, int capacity);

/**
 * Check count of TX dropped bytes due to buffer overflow.
 */
uint32_t bf_hal_serial_tx_dropped(int port_index);

#ifdef __cplusplus
}
#endif

#endif // BF_HAL_H
