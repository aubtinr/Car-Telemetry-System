#include "obd2.h"
#include "can.h"
#include <string.h>

/* CubeMX generates hcan1 in can.c/can.h when CAN1 is enabled. */
extern CAN_HandleTypeDef hcan1;

/*
 * Configure CAN reception.
 *
 * For the first test, the mask is all zeros. In ID-mask mode that means
 * "do not care about any ID bits", so every CAN frame is accepted into FIFO0.
 * This is intentionally broad because it makes first-time debugging easier.
 */
static HAL_StatusTypeDef OBD2_ConfigAcceptAllFilter(void)
{
    CAN_FilterTypeDef filter = {0};

    filter.FilterBank = 0;
    filter.FilterMode = CAN_FILTERMODE_IDMASK;
    filter.FilterScale = CAN_FILTERSCALE_32BIT;

    filter.FilterIdHigh = 0x0000;
    filter.FilterIdLow = 0x0000;
    filter.FilterMaskIdHigh = 0x0000;
    filter.FilterMaskIdLow = 0x0000;

    filter.FilterFIFOAssignment = CAN_FILTER_FIFO0;
    filter.FilterActivation = ENABLE;

    /* STM32F446 has two CAN controllers that share filter banks. */
    filter.SlaveStartFilterBank = 14;

    return HAL_CAN_ConfigFilter(&hcan1, &filter);
}

OBD2_Status OBD2_Init(void)
{
    /* MX_CAN1_Init() must already have been called before this function. */
    if (OBD2_ConfigAcceptAllFilter() != HAL_OK)
    {
        return OBD2_ERROR;
    }

    if (HAL_CAN_Start(&hcan1) != HAL_OK)
    {
        return OBD2_ERROR;
    }

    return OBD2_OK;
}

OBD2_Status OBD2_RequestMode01PID(uint8_t pid,
                                  uint8_t response[8],
                                  uint32_t *response_id,
                                  uint32_t timeout_ms)
{
    CAN_TxHeaderTypeDef tx_header = {0};
    CAN_RxHeaderTypeDef rx_header = {0};
    uint8_t tx_data[8] = {0};
    uint8_t rx_data[8] = {0};
    uint32_t tx_mailbox = 0;
    uint32_t start_tick = 0;

    /* Build a standard 11-bit CAN data frame. */
    tx_header.StdId = OBD2_FUNCTIONAL_REQUEST_ID;
    tx_header.ExtId = 0;
    tx_header.IDE = CAN_ID_STD;
    tx_header.RTR = CAN_RTR_DATA;
    tx_header.DLC = 8;
    tx_header.TransmitGlobalTime = DISABLE;

    /*
     * OBD-II single-frame request:
     * byte 0 = 0x02 -> two diagnostic bytes follow
     * byte 1 = 0x01 -> Mode 01, current/live data
     * byte 2 = PID  -> e.g. 0x0C for engine RPM
     * bytes 3-7     -> padding for this simple request
     */
    tx_data[0] = 0x02;
    tx_data[1] = 0x01;
    tx_data[2] = pid;

    if (HAL_CAN_AddTxMessage(&hcan1, &tx_header, tx_data, &tx_mailbox) != HAL_OK)
    {
        return OBD2_ERROR;
    }

    start_tick = HAL_GetTick();

    while ((HAL_GetTick() - start_tick) < timeout_ms)
    {
        if (HAL_CAN_GetRxFifoFillLevel(&hcan1, CAN_RX_FIFO0) > 0)
        {
            if (HAL_CAN_GetRxMessage(&hcan1,
                                     CAN_RX_FIFO0,
                                     &rx_header,
                                     rx_data) != HAL_OK)
            {
                return OBD2_ERROR;
            }

            /* Ignore extended-ID frames for this first standard OBD-II test. */
            if (rx_header.IDE != CAN_ID_STD)
            {
                continue;
            }

            /* Typical OBD-II ECU response IDs are 0x7E8 through 0x7EF. */
            if ((rx_header.StdId < OBD2_RESPONSE_ID_MIN) ||
                (rx_header.StdId > OBD2_RESPONSE_ID_MAX))
            {
                continue;
            }

            /*
             * A normal Mode 01 response looks like:
             * byte 0: payload length
             * byte 1: 0x41 = positive response to Mode 01
             * byte 2: PID
             * byte 3+: data bytes
             */
            if ((rx_data[1] == 0x41U) && (rx_data[2] == pid))
            {
                memcpy(response, rx_data, 8);

                if (response_id != NULL)
                {
                    *response_id = rx_header.StdId;
                }

                return OBD2_OK;
            }

            /* Unrelated frames are ignored while we keep waiting. */
        }
    }

    return OBD2_TIMEOUT;
}

float OBD2_DecodeRPM(const uint8_t response[8])
{
    /* PID 0x0C: RPM = ((A * 256) + B) / 4 */
    const uint16_t raw = ((uint16_t)response[3] << 8) |
                         (uint16_t)response[4];
    return ((float)raw) / 4.0f;
}

uint8_t OBD2_DecodeSpeedKPH(const uint8_t response[8])
{
    /* PID 0x0D: byte A is vehicle speed directly in km/h. */
    return response[3];
}

int16_t OBD2_DecodeCoolantC(const uint8_t response[8])
{
    /* PID 0x05: coolant temperature [C] = A - 40. */
    return (int16_t)response[3] - 40;
}
