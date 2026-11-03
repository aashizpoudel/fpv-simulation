cmake_minimum_required(VERSION 3.20)
project(betaflight_sitl C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(BF_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../betaflight")

# List of Betaflight core C files needed for flight control in SITL
set(BF_SOURCES
  # Build & Version
  ${BF_ROOT}/src/main/build/build_config.c
  ${BF_ROOT}/src/main/build/debug.c
  ${BF_ROOT}/src/main/build/version.c

  # Common Utilities
  ${BF_ROOT}/src/main/common/maths.c
  ${BF_ROOT}/src/main/common/streambuf.c
  ${BF_ROOT}/src/main/common/crc.c
  ${BF_ROOT}/src/main/common/filter.c
  ${BF_ROOT}/src/main/common/sensor_alignment.c
  ${BF_ROOT}/src/main/common/bitarray.c
  ${BF_ROOT}/src/main/common/printf.c
  ${BF_ROOT}/src/main/common/printf_serial.c
  ${BF_ROOT}/src/main/common/time.c
  ${BF_ROOT}/src/main/common/typeconversion.c
  ${BF_ROOT}/src/main/common/encoding.c
  ${BF_ROOT}/src/main/common/vector.c
  ${BF_ROOT}/src/main/common/gps_conversion.c

  # Configuration
  ${BF_ROOT}/src/main/config/config.c
  ${BF_ROOT}/src/main/config/feature.c
  ${BF_ROOT}/src/main/config/config_streamer.c
  ${BF_ROOT}/src/main/config/config_eeprom.c
  ${BF_ROOT}/src/main/config/simplified_tuning.c

  # Drivers
  ${BF_ROOT}/src/main/drivers/accgyro/accgyro_virtual.c
  ${BF_ROOT}/src/main/drivers/accgyro/gyro_sync.c
  ${BF_ROOT}/src/main/drivers/barometer/barometer_virtual.c
  ${BF_ROOT}/src/main/drivers/timer_common.c
  ${BF_ROOT}/src/main/drivers/motor.c
  ${BF_ROOT}/src/main/drivers/bus.c
  ${BF_ROOT}/src/main/drivers/dshot.c
  ${BF_ROOT}/src/main/drivers/serial.c
  ${BF_ROOT}/src/main/drivers/buf_writer.c
  ${BF_ROOT}/src/main/drivers/stack_check.c
  ${BF_ROOT}/src/main/drivers/io.c
  ${BF_ROOT}/src/main/drivers/display.c
  ${BF_ROOT}/src/main/drivers/light_led.c
  ${BF_ROOT}/src/main/drivers/rx/rx_pwm.c
  ${BF_ROOT}/src/main/drivers/pinio.c
  ${BF_ROOT}/src/main/drivers/resource.c
  ${BF_ROOT}/src/main/drivers/bus_i2c_busdev.c
  ${BF_ROOT}/src/main/drivers/bus_i2c_soft.c
  ${BF_ROOT}/src/main/drivers/vtx_common.c
  ${BF_ROOT}/src/main/drivers/vtx_table.c
  ${BF_ROOT}/src/main/drivers/pwm_output.c

  # Flight Controller Core
  ${BF_ROOT}/src/main/fc/init.c
  ${BF_ROOT}/src/main/fc/core.c
  ${BF_ROOT}/src/main/fc/runtime_config.c
  ${BF_ROOT}/src/main/fc/rc_controls.c
  ${BF_ROOT}/src/main/fc/tasks.c
  ${BF_ROOT}/src/main/fc/rc_modes.c
  ${BF_ROOT}/src/main/fc/controlrate_profile.c
  ${BF_ROOT}/src/main/fc/rc.c
  ${BF_ROOT}/src/main/fc/rc_adjustments.c
  ${BF_ROOT}/src/main/fc/board_info.c
  ${BF_ROOT}/src/main/fc/stats.c
  ${BF_ROOT}/src/main/fc/dispatch.c

  # Receiver
  ${BF_ROOT}/src/main/rx/rx.c
  ${BF_ROOT}/src/main/rx/msp.c
  ${BF_ROOT}/src/main/rx/msp_override.c
  ${BF_ROOT}/src/main/rx/rc_stats.c

  # Sensors
  ${BF_ROOT}/src/main/sensors/initialisation.c
  ${BF_ROOT}/src/main/sensors/compass.c
  ${BF_ROOT}/src/main/sensors/acceleration.c
  ${BF_ROOT}/src/main/sensors/acceleration_init.c
  ${BF_ROOT}/src/main/sensors/gyro.c
  ${BF_ROOT}/src/main/sensors/gyro_init.c
  ${BF_ROOT}/src/main/sensors/boardalignment.c
  ${BF_ROOT}/src/main/sensors/battery.c
  ${BF_ROOT}/src/main/sensors/barometer.c
  ${BF_ROOT}/src/main/sensors/voltage.c
  ${BF_ROOT}/src/main/sensors/current.c
  ${BF_ROOT}/src/main/sensors/adcinternal.c
  ${BF_ROOT}/src/main/sensors/esc_sensor.c

  # Flight Dynamics & Mixer
  ${BF_ROOT}/src/main/flight/failsafe.c
  ${BF_ROOT}/src/main/flight/mixer.c
  ${BF_ROOT}/src/main/flight/mixer_init.c
  ${BF_ROOT}/src/main/flight/mixer_tricopter.c
  ${BF_ROOT}/src/main/flight/servos.c
  ${BF_ROOT}/src/main/flight/servos_tricopter.c
  ${BF_ROOT}/src/main/flight/imu.c
  ${BF_ROOT}/src/main/flight/pid.c
  ${BF_ROOT}/src/main/flight/pid_init.c
  ${BF_ROOT}/src/main/flight/position.c
  ${BF_ROOT}/src/main/flight/gps_rescue_multirotor.c
  ${BF_ROOT}/src/main/flight/autopilot_multirotor.c

  # IO & MSP
  ${BF_ROOT}/src/main/io/beeper.c
  ${BF_ROOT}/src/main/io/statusindicator.c
  ${BF_ROOT}/src/main/io/rcdevice_cam.c
  ${BF_ROOT}/src/main/io/rcdevice.c
  ${BF_ROOT}/src/main/io/gps.c
  ${BF_ROOT}/src/main/io/displayport_msp.c
  ${BF_ROOT}/src/main/io/serial.c
  ${BF_ROOT}/src/main/io/serial_resource.c
  ${BF_ROOT}/src/main/io/gps_virtual.c
  ${BF_ROOT}/src/main/msp/msp.c
  ${BF_ROOT}/src/main/msp/msp_box.c
  ${BF_ROOT}/src/main/msp/msp_serial.c
  ${BF_ROOT}/src/main/msp/msp_build_info.c

  # CLI & Scheduler
  ${BF_ROOT}/src/main/cli/cli.c
  ${BF_ROOT}/src/main/cli/settings.c
  ${BF_ROOT}/src/main/blackbox/blackbox.c
  ${BF_ROOT}/src/main/blackbox/blackbox_encoding.c
  ${BF_ROOT}/src/main/blackbox/blackbox_io.c
  ${BF_ROOT}/src/main/blackbox/blackbox_virtual.c
  ${BF_ROOT}/src/main/scheduler/scheduler.c

  # External libraries in betaflight/lib
  ${BF_ROOT}/lib/main/dyad/dyad.c
  ${BF_ROOT}/lib/main/google/olc/olc.c

  # Our HAL Shim
  ${CMAKE_CURRENT_SOURCE_DIR}/bf_hal.c
)

# Add all Parameter Group definitions
file(GLOB BF_PG_SOURCES "${BF_ROOT}/src/main/pg/*.c")

add_library(betaflight STATIC
  ${BF_SOURCES}
  ${BF_PG_SOURCES}
)

target_include_directories(betaflight PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${BF_ROOT}/src/main
  ${BF_ROOT}/src/platform/SIMULATOR
  ${BF_ROOT}/src/platform/SIMULATOR/include
  ${BF_ROOT}/src/platform/SIMULATOR/target/SITL
  ${BF_ROOT}/lib/main/dyad
)

target_compile_definitions(betaflight PUBLIC
  SITL
  __TARGET__="SITL"
  __REVISION__="7bd98d8"
  SIMULATOR_BUILD=1
  SET_IMU_FROM_EULER=1
  FLASH_SIZE=2048
  HSE_VALUE=8000000
  _GNU_SOURCE
)

target_compile_options(betaflight PRIVATE
  -Wno-incompatible-pointer-types
  -O2
)
