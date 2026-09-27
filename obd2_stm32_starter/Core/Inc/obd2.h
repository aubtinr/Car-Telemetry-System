#ifndef INC_OBD2_H_
#define INC_OBD2_H_

#include "main.h"
#include <stdint.h>

/* Common Mode 01 OBD-II PIDs used by this starter. */
#define OBD2_PID_COOLANT_TEMP   0x05U
#define OBD2_PID_ENGINE_RPM     0x0CU
#define OBD2_PID_VEHICLE_SPEED  0x0DU

/* Standard 11-bit CAN ID used for a functional OBD-II request. */
#define OBD2_FUNCTIONAL_REQUEST_ID  0x7DFU

/* Typical 11-bit response ID range for OBD-II ECUs. */
#define OBD2_RESPONSE_ID_MIN  0x7E8U
#define OBD2_RESPONSE_ID_MAX  0x7EFU

/* Small set of status codes for beginner-friendly debugging. */
typedef enum
{
    OBD2_OK = 0,
    OBD2_ERROR,
    OBD2_TIMEOUT,
    OBD2_BAD_RESPONSE
} OBD2_Status;

/* Configure the CAN receive filter and start CAN1. */
OBD2_Status OBD2_Init(void);

/*
 * Send a Mode 01 PID request and wait for a matching response.
 *
 * pid         - PID to request, for example 0x0C for RPM
 * response    - 8-byte buffer receiving the CAN payload
 * response_id - optional pointer receiving the responding ECU CAN ID
 * timeout_ms  - maximum time to wait for a matching response
 */
OBD2_Status OBD2_RequestMode01PID(uint8_t pid,
                                  uint8_t response[8],
                                  uint32_t *response_id,
                                  uint32_t timeout_ms);

/* Decode helpers for the three starter PIDs. */
float OBD2_DecodeRPM(const uint8_t response[8]);
uint8_t OBD2_DecodeSpeedKPH(const uint8_t response[8]);
int16_t OBD2_DecodeCoolantC(const uint8_t response[8]);

#endif /* INC_OBD2_H_ */
