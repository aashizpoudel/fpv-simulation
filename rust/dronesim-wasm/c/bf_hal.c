/**
 * Minimal in-memory Hardware Abstraction Layer (HAL) for Betaflight SITL.
 * Bridges Betaflight directly to the Rust simulation engine.
 */

#include "bf_hal.h"

#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>

#include "platform.h"
#include "common/maths.h"
#include "common/utils.h"

#include "fc/init.h"
#include "fc/runtime_config.h"
#include "fc/rc.h"
#include "fc/rc_controls.h"
#include "scheduler/scheduler.h"
#include "rx/rx.h"
#include "flight/imu.h"
#include "sensors/sensors.h"
#include "sensors/voltage.h"
#include "sensors/current.h"
#include "drivers/accgyro/accgyro_virtual.h"
#include "drivers/serial.h"
#include "drivers/system.h"
#include "drivers/pwm_output.h"
#include "drivers/motor_impl.h"
#include "pg/motor.h"
#include "io/serial.h"
#include "config/config_streamer.h"
#include "config/config_streamer_impl.h"

#define MAX_MOTORS 4
#define RC_CHANNEL_COUNT 8
#define SERIAL_BUFFER_SIZE 65536

// =============================================================================
// Timekeeping State
// =============================================================================
static uint64_t s_sim_micros = 0;

uint32_t micros(void) {
    return (uint32_t)(s_sim_micros & 0xFFFFFFFF);
}

uint32_t millis(void) {
    return (uint32_t)(s_sim_micros / 1000);
}

uint64_t micros64(void) {
    return s_sim_micros;
}

void bf_hal_advance_time(uint32_t dt_us) {
    s_sim_micros += dt_us;
}

// =============================================================================
// Motor Capture State
// =============================================================================
static float s_motors_pwm[MAX_MOTORS] = {1000.0f, 1000.0f, 1000.0f, 1000.0f};

void pwmWriteMotor(uint8_t index, float value) {
    if (index < MAX_MOTORS) {
        s_motors_pwm[index] = value;
    }
}

void pwmCompleteMotorUpdate(uint8_t motorCount) {
    UNUSED(motorCount);
}

float bf_hal_get_motor_pwm(uint8_t index) {
    return (index < MAX_MOTORS) ? s_motors_pwm[index] : 1000.0f;
}

float bf_hal_get_motor_command(uint8_t index) {
    if (index >= MAX_MOTORS) return 0.0f;
    float pwm = s_motors_pwm[index];
    float cmd = (pwm - 1000.0f) / 1000.0f;
    return constrainf(cmd, 0.0f, 1.0f);
}

// =============================================================================
// Sensor Inputs (IMU & Battery)
// =============================================================================
void bf_hal_set_imu(float gyro_x, float gyro_y, float gyro_z,
                    float acc_x, float acc_y, float acc_z) {
    const float GYRO_SCALE = 16.4f * (180.0f / 3.14159265358979f);
    const float ACC_SCALE = 256.0f / 9.80665f;

    if (virtualGyroDev) {
        virtualGyroSet(virtualGyroDev,
            (int16_t)constrain((int)(-gyro_z * GYRO_SCALE), -32767, 32767),
            (int16_t)constrain((int)( gyro_x * GYRO_SCALE), -32767, 32767),
            (int16_t)constrain((int)(-gyro_y * GYRO_SCALE), -32767, 32767));
    }

    if (virtualAccDev) {
        virtualAccSet(virtualAccDev,
            (int16_t)constrain((int)(-acc_z * ACC_SCALE), -32767, 32767),
            (int16_t)constrain((int)( acc_x * ACC_SCALE), -32767, 32767),
            (int16_t)constrain((int)( acc_y * ACC_SCALE), -32767, 32767));
    }
}

void bf_hal_set_attitude_quat(float w, float x, float y, float z) {
    imuSetAttitudeQuat(w, -z, -x, y);
}

void bf_hal_set_battery(float voltage_sag, float voltage_unfiltered,
                        float amperage, float mah_drawn, uint8_t cell_count) {
    UNUSED(cell_count);
    // Directly update Betaflight battery meters if available
    extern voltageMeter_t *getVoltageMeter(void) __attribute__((weak));
    extern currentMeter_t *getCurrentMeter(void) __attribute__((weak));

    if (getVoltageMeter) {
        voltageMeter_t *v = getVoltageMeter();
        if (v) {
            v->unfiltered = (uint16_t)(voltage_unfiltered * 100.0f);
            v->displayFiltered = (uint16_t)(voltage_sag * 100.0f);
            v->sagFiltered = (uint16_t)(voltage_sag * 100.0f);
        }
    }
    if (getCurrentMeter) {
        currentMeter_t *c = getCurrentMeter();
        if (c) {
            c->amperage = (int32_t)(amperage * 100.0f);
            c->amperageLatest = (int32_t)(amperage * 100.0f);
            c->mAhDrawn = (int32_t)mah_drawn;
        }
    }
}

// =============================================================================
// Virtual RC Receiver Driver
// =============================================================================
static uint16_t s_rcDataCache[RC_CHANNEL_COUNT] = {1500, 1500, 1000, 1500, 1000, 1000, 1000, 1000};
static uint32_t s_rcDataReceptionTimeUs = 0;

static float rxRcReadData(const rxRuntimeState_t *rxRuntimeState, uint8_t channel) {
    UNUSED(rxRuntimeState);
    return channel < RC_CHANNEL_COUNT ? (float)s_rcDataCache[channel] : 1500.0f;
}

static uint8_t rxRcFrameStatus(rxRuntimeState_t *rxRuntimeState) {
    UNUSED(rxRuntimeState);
    return RX_FRAME_COMPLETE;
}

void bf_hal_set_rc(const float channels[8]) {
    uint32_t timeUs = (uint32_t)(s_sim_micros & 0xFFFFFFFF);
    for (int i = 0; i < 8; i++) {
        s_rcDataCache[i] = (uint16_t)constrain((int)(1500.0f + channels[i] * 500.0f), 1000, 2000);
    }
    s_rcDataReceptionTimeUs = timeUs;
    rxRuntimeState.channelCount = RC_CHANNEL_COUNT;
    rxRuntimeState.rcReadRawFn = rxRcReadData;
    rxRuntimeState.rcFrameStatusFn = rxRcFrameStatus;
    rxRuntimeState.rxProvider = RX_PROVIDER_UDP;
    rxRuntimeState.lastRcFrameTimeUs = timeUs;
}

// =============================================================================
// In-Memory Virtual Serial Ring Buffer (MSP / Configurator)
// =============================================================================
typedef struct {
    serialPort_t port;
    uint8_t rxBuffer[SERIAL_BUFFER_SIZE];
    uint8_t txBuffer[SERIAL_BUFFER_SIZE];
    uint32_t rxHead, rxTail;
    uint32_t txHead, txTail;
    uint32_t txDropped;
    bool opened;
} memSerialPort_t;

static memSerialPort_t s_serial_ports[SERIAL_PORT_COUNT];

static uint32_t ring_used(uint32_t head, uint32_t tail, uint32_t size) {
    return head >= tail ? head - tail : size - tail + head;
}

static uint32_t serial_rx_waiting(const serialPort_t *instance) {
    const memSerialPort_t *p = (const memSerialPort_t *)instance;
    return ring_used(p->rxHead, p->rxTail, SERIAL_BUFFER_SIZE);
}

static uint32_t serial_tx_free(const serialPort_t *instance) {
    const memSerialPort_t *p = (const memSerialPort_t *)instance;
    uint32_t free_bytes = SERIAL_BUFFER_SIZE - 1 - ring_used(p->txHead, p->txTail, SERIAL_BUFFER_SIZE);
    return free_bytes ? free_bytes : 1;
}

static uint8_t serial_read(serialPort_t *instance) {
    memSerialPort_t *p = (memSerialPort_t *)instance;
    if (!serial_rx_waiting(instance)) return 0;
    uint8_t b = p->rxBuffer[p->rxTail];
    p->rxTail = (p->rxTail + 1) % SERIAL_BUFFER_SIZE;
    return b;
}

static void serial_write(serialPort_t *instance, uint8_t ch) {
    memSerialPort_t *p = (memSerialPort_t *)instance;
    if (ring_used(p->txHead, p->txTail, SERIAL_BUFFER_SIZE) == SERIAL_BUFFER_SIZE - 1) {
        p->txTail = (p->txTail + 1) % SERIAL_BUFFER_SIZE;
        p->txDropped++;
    }
    p->txBuffer[p->txHead] = ch;
    p->txHead = (p->txHead + 1) % SERIAL_BUFFER_SIZE;
}

static bool serial_is_tx_empty(const serialPort_t *instance) {
    const memSerialPort_t *p = (const memSerialPort_t *)instance;
    return p->txHead == p->txTail;
}

static const struct serialPortVTable s_mem_serial_vtable = {
    .serialWrite = serial_write,
    .serialTotalRxWaiting = serial_rx_waiting,
    .serialTotalTxFree = serial_tx_free,
    .serialRead = serial_read,
    .isSerialTransmitBufferEmpty = serial_is_tx_empty,
};

serialPort_t *serialMemOpen(serialPortIdentifier_e identifier) {
    int index = findSerialPortIndexByIdentifier(identifier);
    if (index < 0 || index >= SERIAL_PORT_COUNT) return NULL;
    memSerialPort_t *p = &s_serial_ports[index];
    memset(p, 0, sizeof(*p));
    p->port.vTable = &s_mem_serial_vtable;
    p->port.rxBuffer = p->rxBuffer;
    p->port.txBuffer = p->txBuffer;
    p->port.rxBufferSize = SERIAL_BUFFER_SIZE;
    p->port.txBufferSize = SERIAL_BUFFER_SIZE;
    p->opened = true;
    return &p->port;
}

serialPort_t *serTcpOpen(serialPortIdentifier_e identifier,
    serialReceiveCallbackPtr rxCallback, void *rxCallbackData,
    uint32_t baudRate, portMode_e mode, portOptions_e options)
{
    UNUSED(rxCallback);
    UNUSED(rxCallbackData);
    UNUSED(baudRate);
    UNUSED(mode);
    UNUSED(options);
    return serialMemOpen(identifier);
}

int bf_hal_serial_rx(int port_index, const uint8_t *data, int length) {
    if (port_index < 0 || port_index >= SERIAL_PORT_COUNT || !s_serial_ports[port_index].opened || !data || length <= 0)
        return -1;
    memSerialPort_t *p = &s_serial_ports[port_index];
    int count = 0;
    while (count < length && ring_used(p->rxHead, p->rxTail, SERIAL_BUFFER_SIZE) < SERIAL_BUFFER_SIZE - 1) {
        p->rxBuffer[p->rxHead] = data[count++];
        p->rxHead = (p->rxHead + 1) % SERIAL_BUFFER_SIZE;
    }
    return count;
}

int bf_hal_serial_tx(int port_index, uint8_t *buffer, int capacity) {
    if (port_index < 0 || port_index >= SERIAL_PORT_COUNT || !s_serial_ports[port_index].opened || !buffer || capacity <= 0)
        return -1;
    memSerialPort_t *p = &s_serial_ports[port_index];
    int count = 0;
    while (count < capacity && p->txHead != p->txTail) {
        buffer[count++] = p->txBuffer[p->txTail];
        p->txTail = (p->txTail + 1) % SERIAL_BUFFER_SIZE;
    }
    return count;
}

uint32_t bf_hal_serial_tx_dropped(int port_index) {
    return (port_index >= 0 && port_index < SERIAL_PORT_COUNT) ? s_serial_ports[port_index].txDropped : 0;
}

// =============================================================================
// Lifecycle & Configuration
// =============================================================================
uint32_t SystemCoreClock = 500000000;
char _estack;
char _Min_Stack_Size;

static const char *s_eeprom_filename = EEPROM_FILENAME;
static uint8_t s_eepromData[EEPROM_SIZE];
static FILE *s_eepromFd = NULL;

void bf_hal_set_eeprom_filename(const char *filename) {
    if (filename) {
        s_eeprom_filename = filename;
    }
}

bool loadEEPROMFromFile(void) {
    if (s_eepromFd != NULL) return false;
    s_eepromFd = fopen(s_eeprom_filename, "r+");
    if (s_eepromFd != NULL) {
        fseek(s_eepromFd, 0, SEEK_END);
        size_t lSize = ftell(s_eepromFd);
        rewind(s_eepromFd);
        fread(s_eepromData, 1, sizeof(s_eepromData), s_eepromFd);
    } else {
        s_eepromFd = fopen(s_eeprom_filename, "w+");
        if (s_eepromFd != NULL) {
            fwrite(s_eepromData, sizeof(s_eepromData), 1, s_eepromFd);
        }
    }
    return true;
}

void configUnlock(void) {
    loadEEPROMFromFile();
}

void configLock(void) {
    if (s_eepromFd != NULL) {
        fseek(s_eepromFd, 0, SEEK_SET);
        fwrite(s_eepromData, 1, sizeof(s_eepromData), s_eepromFd);
        fclose(s_eepromFd);
        s_eepromFd = NULL;
    }
}

configStreamerResult_e configWriteWord(uintptr_t address, config_streamer_buffer_type_t *buffer) {
    if ((address >= (uintptr_t)s_eepromData) &&
        (address + sizeof(uint32_t) <= (uintptr_t)(s_eepromData + sizeof(s_eepromData)))) {
        memcpy((void*)address, buffer, sizeof(config_streamer_buffer_type_t));
    }
    return CONFIG_RESULT_SUCCESS;
}

// =============================================================================
// Motor Driver Bindings
// =============================================================================
static pwmOutputPort_t s_pwmMotors[MAX_MOTORS];

pwmOutputPort_t *pwmGetMotors(void) {
    return s_pwmMotors;
}

static float pwmConvertFromExternal(uint16_t externalValue) {
    return (float)externalValue;
}

static uint16_t pwmConvertToExternal(float motorValue) {
    return (uint16_t)motorValue;
}

static void pwmEnableMotors(void) {}
static void pwmDisableMotors(void) {}
static bool pwmIsMotorEnabled(uint8_t index) { UNUSED(index); return true; }
static void pwmShutdownPulsesForAllMotors(void) {}

static const motorVTable_t s_motorVTable = {
    .postInit = motorPostInitNull,
    .convertExternalToMotor = pwmConvertFromExternal,
    .convertMotorToExternal = pwmConvertToExternal,
    .enable = pwmEnableMotors,
    .disable = pwmDisableMotors,
    .isMotorEnabled = pwmIsMotorEnabled,
    .decodeTelemetry = motorDecodeTelemetryNull,
    .write = pwmWriteMotor,
    .writeInt = NULL,
    .updateComplete = pwmCompleteMotorUpdate,
    .shutdown = pwmShutdownPulsesForAllMotors,
    .requestTelemetry = NULL,
    .isMotorIdle = NULL,
    .getMotorIO = NULL,
};

bool motorPwmDevInit(motorDevice_t *device, const motorDevConfig_t *motorConfig, uint16_t _idlePulse) {
    UNUSED(motorConfig);
    UNUSED(_idlePulse);
    if (!device) return false;
    device->vTable = &s_motorVTable;
    for (int i = 0; i < MAX_MOTORS; i++) {
        s_pwmMotors[i].enabled = true;
    }
    return true;
}

// =============================================================================
// Platform & System Stubs
// =============================================================================
void systemInit(void) {}
void systemReset(void) {}
void systemResetToBootloader(bootloaderRequestType_e requestType) { UNUSED(requestType); }
void timerInit(void) {}
void failureMode(failureMode_e mode) { UNUSED(mode); }
void indicateFailure(failureMode_e mode, int repeatCount) { UNUSED(mode); UNUSED(repeatCount); }
void delayMicroseconds(uint32_t us) { s_sim_micros += us; }
void delay(uint32_t ms) { s_sim_micros += (uint64_t)ms * 1000; }
uint32_t getCycleCounter(void) { return (uint32_t)s_sim_micros; }
uint32_t clockMicrosToCycles(uint32_t micros) { return micros; }
int32_t clockCyclesToMicros(int32_t cycles) { return cycles; }

void unusedPinsInit(void) {}
void IOConfigGPIO(IO_t io, ioConfig_t cfg) { UNUSED(io); UNUSED(cfg); }
void IOHi(IO_t io) { UNUSED(io); }
void IOLo(IO_t io) { UNUSED(io); }
void IOInitGlobal(void) {}
IO_t IOGetByTag(ioTag_t tag) { UNUSED(tag); return NULL; }

const mcuTypeInfo_t *getMcuTypeInfo(void) {
    static const mcuTypeInfo_t info = { .id = MCU_TYPE_SIMULATOR, .name = "SIMULATOR" };
    return &info;
}

void spektrumBind(rxConfig_t *rxConfig) { UNUSED(rxConfig); }
void debugInit(void) {}

bool bf_hal_is_armed(void) {
    return ARMING_FLAG(ARMED);
}

int bf_hal_init(void) {
    // Reset RC channels to center before boot
    for (int i = 0; i < RC_CHANNEL_COUNT; i++) {
        s_rcDataCache[i] = 1500;
    }
    s_rcDataCache[2] = 1000; // Throttle low

    init();
    return 1;
}

void bf_hal_scheduler(void) {
    scheduler();
}
