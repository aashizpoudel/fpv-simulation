param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$rustDir = Join-Path $repo 'rust/dronesim-wasm'
$manifest = Join-Path $rustDir 'Cargo.toml'

# 1. Locate Cargo
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargo) {
    $cargoPath = Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
    if (-not (Test-Path $cargoPath)) { throw 'Cargo is required to build DroneSim WASM' }
    $cargo = @{ Source = $cargoPath }
}

Write-Host "==> Compiling Rust motor plant (staticlib)..."
& $cargo.Source build --manifest-path $manifest --release --target wasm32-unknown-unknown
if ($LASTEXITCODE) { throw 'Rust staticlib build failed' }

# Ensure Betaflight WASM patch is applied
$patchFile = Join-Path $rustDir 'patches/0001-wasm-pg-sections.patch'
$bfDir = Join-Path $rustDir 'betaflight'
$patchApplied = $false
if (Test-Path $patchFile) {
    git -C $bfDir apply --check $patchFile 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "==> Applying Betaflight WASM patch..."
        git -C $bfDir apply $patchFile
        $patchApplied = $true
    }
}

try {
    # 2. Build Betaflight C library and link via Docker emscripten
    Write-Host "==> Compiling Betaflight C core and linking with Rust via Docker..."
    $dockerPath = ($repo -replace '\\', '/')

    $exports = @(
        '_malloc',
        '_free',
        '_dronesim_config_len',
        '_dronesim_config_alloc',
        '_dronesim_config_free',
        '_dronesim_init',
        '_dronesim_free',
        '_dronesim_reset',
        '_dronesim_set_rates',
        '_dronesim_set_pid_rate_config',
        '_dronesim_step',
        '_dronesim_rpm',
        '_dronesim_thrust',
        '_dronesim_torque',
        '_dronesim_voltage',
        '_dronesim_current',
        '_dronesim_charge',
        '_dronesim_flight_step',
        '_dronesim_flight_step_raw',
        '_dronesim_is_armed',
        '_dronesim_motor_command',
        '_dronesim_motor_pwm',
        '_dronesim_serial_push',
        '_dronesim_serial_pull',
        '_bf_hal_init',
        '_bf_hal_scheduler',
        '_bf_hal_advance_time',
        '_bf_hal_is_armed',
        '_bf_hal_reset_flight_state',
        '_bf_hal_debug_arm',
        '_bf_hal_get_arming_disable_flags',
        '_bf_hal_set_eeprom_filename',
        '_bf_hal_set_imu',
        '_bf_hal_set_attitude_quat',
        '_bf_hal_set_rc',
        '_bf_hal_set_battery',
        '_bf_hal_get_motor_command',
        '_bf_hal_get_motor_pwm',
        '_bf_hal_serial_rx',
        '_bf_hal_serial_tx',
        '_bf_hal_serial_tx_dropped'
    ) -join ','

    $cmd = "emcmake cmake -S c -B c/build -DCMAKE_BUILD_TYPE=Release && " +
           "cmake --build c/build -j 4 && " +
           "emcc -Wl,--whole-archive c/build/libbetaflight.a target/wasm32-unknown-unknown/release/libdronesim_wasm.a -Wl,--no-whole-archive " +
           "-O2 -g -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createDroneSim -sENVIRONMENT=web,worker,node -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 -sNO_EXIT_RUNTIME=1 -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAPF32 " +
           "-sEXPORTED_FUNCTIONS=$exports " +
           "-o target/dronesim.js"

    docker run --rm -v "${dockerPath}/rust/dronesim-wasm:/workspace" -w /workspace emscripten/emsdk:4.0.21 sh -c $cmd
    if ($LASTEXITCODE) { throw 'Docker build/link failed' }
}
finally {
    if ($patchApplied) {
        Write-Host "==> Cleaning Betaflight submodule..."
        git -C $bfDir checkout -- .
    }
}

# 3. Copy to public distribution directory & src/vendor
$out = Join-Path $repo 'public/wasm/dronesim'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item -LiteralPath (Join-Path $rustDir 'target/dronesim.wasm') -Destination (Join-Path $out 'dronesim_wasm.wasm') -Force

$vendor = Join-Path $repo 'src/vendor'
New-Item -ItemType Directory -Force $vendor | Out-Null
Copy-Item -LiteralPath (Join-Path $rustDir 'target/dronesim.js') -Destination (Join-Path $vendor 'dronesim.js') -Force

Write-Host "==> Unified DroneSim + Betaflight WASM successfully built: public/wasm/dronesim/dronesim_wasm.wasm & src/vendor/dronesim.js"
