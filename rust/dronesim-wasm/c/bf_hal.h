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
 * [0: Roll, 1: Pitch, 2: Throttle, 3: Yaw, 4: AUX1 (Arm), 5: AUX2 (Mode), 6: AUX3, 7: AUX4]
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
