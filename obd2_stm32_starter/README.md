# STM32 OBD-II CAN Starter

Target hardware:

- **MCU board:** ST NUCLEO-F446RE
- **CAN transceiver:** TJA1050 module
- **Vehicle/bench source:** OBD-II vehicle or ECUsim 2000
- **IDE:** STM32CubeIDE / CubeMX
- **CAN protocol used here:** ISO 15765-4 CAN, 11-bit IDs, 500 kbit/s
- **Example OBD-II service:** Mode 01 (current/live data)

This repository is intentionally simple and heavily commented because it is meant as a first CAN/OBD-II project.

## What the starter code does

The STM32:

1. Starts CAN1.
2. Configures an "accept all" CAN receive filter.
3. Sends a functional OBD-II request on CAN ID `0x7DF`.
4. Waits for an ECU response on IDs `0x7E8` through `0x7EF`.
5. Reads six Mode 01 PIDs:
   - `0x0C` = engine RPM
   - `0x0D` = vehicle speed
   - `0x05` = coolant temperature
      - `0x10` = mass airflow
      - `0x11` = throttle position
      - `0x14` = oxygen sensor voltage
6. Sends one raw, newline-delimited JSON frame per polling cycle through USART2.

The code uses a simple blocking request/response method on purpose. Once this works, the project can be upgraded to interrupts, queues, multiple polling rates, logging, and communication with the Raspberry Pi.

## Data path

```text
ECUsim / Vehicle
      |
      | OBD-II CAN-H / CAN-L
      v
TJA1050 CAN transceiver
      |
      | TXD / RXD logic signals
      v
NUCLEO-F446RE
      |
      | USB serial / UART
      v
PC or Raspberry Pi
```

## Important electrical note

The TJA1050 is a **5 V CAN transceiver**. Verify the exact TJA1050 breakout module you purchased before wiring it.

The STM32F446 uses 3.3 V logic. Do not assume every inexpensive CAN module safely interfaces with every 3.3 V MCU pin just because the listing says "for STM32."

Also connect the grounds of the STM32, transceiver, and simulator together.

## Suggested CAN1 pins

One common CAN1 mapping on the STM32F446RE is:

```text
PB9  -> CAN1_TX
PB8  -> CAN1_RX
```

Configure the pins in CubeMX rather than manually changing alternate-function registers.

A typical wiring concept is:

```text
NUCLEO-F446RE       TJA1050 module
-------------       --------------
5V              ->  VCC
GND             ->  GND
PB9 / CAN1_TX   ->  TXD
PB8 / CAN1_RX   <-  RXD

TJA1050 CANH    ->  OBD-II / ECUsim CAN-H
TJA1050 CANL    ->  OBD-II / ECUsim CAN-L
```

Check the labels on your exact module before connecting it.

## CubeMX / CubeIDE setup

Create a NUCLEO-F446RE project and enable:

### 1. CAN1

Use **Normal** mode when connected to the ECUsim or car.

For a CAN peripheral clock of 45 MHz, one valid 500 kbit/s timing is:

```text
Prescaler        = 6
Time Segment 1   = 12 TQ
Time Segment 2   = 2 TQ
SJW              = 1 TQ
```

Calculation:

```text
45 MHz / [6 * (1 + 12 + 2)] = 500 kbit/s
```

**Important:** Verify the actual CAN/APB1 clock in your CubeMX clock tree. If your clock differs, these timing values must be recalculated.

### 2. USART2

Enable USART2 for the Pi telemetry stream. A normal setting is:

```text
115200 baud
8 data bits
No parity
1 stop bit
```

### 3. Generate code

CubeMX should generate files such as:

```text
Core/Inc/main.h
Core/Inc/can.h
Core/Inc/usart.h
Core/Inc/gpio.h
Core/Src/main.c
Core/Src/can.c
Core/Src/usart.c
Core/Src/gpio.c
```

`Core/Src/obd2.c` and `Core/Inc/obd2.h` are helpers for the human-readable debug example. The active root `main.c` polls and serializes raw responses directly. For the Pi, use its JSON framing and keep the UART free of debug text while preserving the clock and peripheral setup for your board.

## What an RPM request looks like

The STM32 sends:

```text
CAN ID: 0x7DF
02 01 0C 00 00 00 00 00
```

Meaning:

```text
02 = two OBD bytes follow
01 = Mode 01: current/live data
0C = PID 0x0C: engine RPM
```

A typical ECU response is:

```text
CAN ID: 0x7E8
04 41 0C A B 00 00 00
```

RPM is:

```text
RPM = ((A * 256) + B) / 4
```

## First test

Confirm that the simulator values appear in newline-delimited JSON on the ST-LINK virtual COM port. For example:

```json
{"type":"obd_raw","v":1,"seq":1,"uptime_ms":1000,"pids":{"0C":"2710","0D":"28","05":"82","10":"0280","11":"38","14":"6F80"},"no_response":[]}
```

The `pids` values are raw response data bytes (without the `41` mode and PID bytes); the Pi applies the OBD-II formulas. PIDs that do not answer a cycle are listed in `no_response`. Keep USART2 at 115200 baud, 8-N-1, and connect the Nucleo USB virtual COM port to the Pi. See `car-telemetry/docs/raw-frame-contract.md` for the complete schema.

## Next upgrades after this works

1. Supported-PID discovery (`01 00`, `01 20`, etc.).
2. CAN receive interrupts instead of polling.
3. Request scheduler with different PID refresh rates.
4. Better timeout/error states.
5. DTC reading.
6. Logging/replay.
7. GPS/IMU/lap mode.

## Safety / scope

This starter only performs diagnostic read requests. Do not add ECU write, actuator-control, coding, flashing, or configuration commands for normal vehicle testing.

Bench-test with the ECUsim before connecting to a real vehicle.
