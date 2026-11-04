export interface DroneSimModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  FS: {
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string, opts?: { encoding?: "binary" | "utf8" }): Uint8Array | string;
    unlink(path: string): void;
  };
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _dronesim_config_len(): number;
  _dronesim_config_alloc(): number;
  _dronesim_config_free(pointer: number): void;
  _dronesim_init(pointer: number, length: number): number;
  _dronesim_free(handle: number): void;
  _dronesim_reset(handle: number): void;
  /** values: 10 bytes [type, RC rates R/P/Y, expo R/P/Y, super rates R/P/Y] in Betaflight units. */
  _dronesim_set_rates(handle: number, values: number, length: number): number;
  /** values: 9 bytes [roll P/I/D, pitch P/I/D, yaw P/I/D] in Betaflight units; disarmed only. */
  _dronesim_set_pid_rate_config(handle: number, values: number, length: number): number;
  _dronesim_step(handle: number, m0: number, m1: number, m2: number, m3: number, airspeed: number, armed: number, dt: number): number;
  _dronesim_flight_step(
    handle: number,
    rcRoll: number, rcPitch: number, rcThrottle: number, rcYaw: number, rcArm: number, rcMode: number,
    legacyRcChannelOrder: number,
    gx: number, gy: number, gz: number,
    ax: number, ay: number, az: number,
    qw: number, qx: number, qy: number, qz: number,
    axialAirspeed: number,
    dt: number
  ): number;
  _dronesim_flight_step_raw(
    handle: number, rcChannels: number, rcLength: number,
    gx: number, gy: number, gz: number,
    ax: number, ay: number, az: number,
    qw: number, qx: number, qy: number, qz: number,
    axialAirspeed: number, dt: number
  ): number;
  _dronesim_rpm(handle: number, rotor: number): number;
  _dronesim_thrust(handle: number, rotor: number): number;
  _dronesim_torque(handle: number, rotor: number): number;
  _dronesim_voltage(handle: number): number;
  _dronesim_current(handle: number): number;
  _dronesim_charge(handle: number): number;
  _dronesim_is_armed(handle: number): number;
  _dronesim_motor_command(handle: number, rotor: number): number;
  _dronesim_motor_pwm(handle: number, rotor: number): number;
  _dronesim_serial_push(handle: number, port: number, data: number, length: number): number;
  _dronesim_serial_pull(handle: number, port: number, buffer: number, capacity: number): number;
  _bf_hal_init(): number;
  _bf_hal_scheduler(): void;
  _bf_hal_advance_time(dtUs: number): void;
  _bf_hal_is_armed(): boolean;
  _bf_hal_set_eeprom_filename(filename: number): void;
  _bf_hal_set_imu(gx: number, gy: number, gz: number, ax: number, ay: number, az: number): void;
  _bf_hal_set_attitude_quat(w: number, x: number, y: number, z: number): void;
  _bf_hal_set_rc(channels: number): void;
  _bf_hal_set_battery(sag: number, unf: number, amp: number, mah: number, cells: number): void;
  _bf_hal_get_motor_command(index: number): number;
  _bf_hal_get_motor_pwm(index: number): number;
  _bf_hal_serial_rx(port: number, data: number, len: number): number;
  _bf_hal_serial_tx(port: number, buffer: number, cap: number): number;
  _bf_hal_serial_tx_dropped(port: number): number;
}

export default function createDroneSim(options?: {
  locateFile?: (path: string, prefix: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}): Promise<DroneSimModule>;
