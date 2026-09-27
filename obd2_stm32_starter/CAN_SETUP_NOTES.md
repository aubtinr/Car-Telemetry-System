# CAN / CubeMX Setup Notes

These notes are separate from the C source so the team can use them while configuring CubeIDE.

## 1. Create the project

In STM32CubeIDE:

1. File -> New -> STM32 Project
2. Board Selector
3. Search for `NUCLEO-F446RE`
4. Create project

## 2. Enable CAN1

In the pinout/configuration view:

- Enable CAN1
- Select Normal mode
- Assign:
  - PB8 = CAN1_RX
  - PB9 = CAN1_TX

Check that these pins are actually available and are not used by another peripheral.

## 3. CAN bitrate

Your ECUsim CAN configuration will typically use 500 kbit/s for ISO 15765-4.

If CAN clock = 45 MHz, this timing gives 500 kbit/s:

```text
Prescaler = 6
BS1 = 12 TQ
BS2 = 2 TQ
SJW = 1 TQ
```

Formula:

```text
bitrate = CAN_clock / [prescaler * (1 + BS1 + BS2)]
```

So:

```text
45,000,000 / [6 * (1 + 12 + 2)] = 500,000 bit/s
```

Do not blindly copy these values if your APB1/CAN clock is different.

## 4. Enable USART2

Suggested beginner settings:

```text
115200 baud
8 data bits
No parity
1 stop bit
```

This lets the code print telemetry through the Nucleo's virtual COM port.

## 5. Generate code

Let CubeMX generate the initialization code.

Then add:

```text
Core/Inc/obd2.h
Core/Src/obd2.c
```

The starter `main.c` shows the application logic. The safest workflow is:

1. Keep your CubeMX-generated `main.c`.
2. Add `#include "obd2.h"`.
3. Copy the application logic into the generated file's USER CODE sections.
4. Keep CubeMX's real `SystemClock_Config()` and `Error_Handler()`.

## 6. Serial terminal

Connect the Nucleo over USB and open the ST-LINK virtual COM port with:

```text
115200
8-N-1
```

Expected output after the simulator responds:

```text
CAN started successfully.
ECU 0x7E8 | RPM: 2500.0
ECU 0x7E8 | Speed: 40 km/h
ECU 0x7E8 | Coolant: 90 C
----------------------------------------
```

## 7. If you get only timeouts

Check these in this order:

1. Is the simulator powered?
2. Is it configured for CAN / ISO 15765-4?
3. Is the bitrate correct?
4. Are CAN-H and CAN-L reversed?
5. Are all grounds connected?
6. Is the TJA1050 powered correctly?
7. Are PB8/PB9 mapped correctly?
8. Is CAN in Normal mode?
9. Is the CAN bus terminated properly?
10. Does the simulator support the requested PID?

## 8. Good first debugging strategy

Before using OBD-II:

- Use CAN loopback mode to prove the STM32 CAN peripheral/code works.
- Then switch to Normal mode and connect the transceiver/simulator.
- Then request only RPM (`0x0C`).
- Add speed and temperature only after RPM works.
