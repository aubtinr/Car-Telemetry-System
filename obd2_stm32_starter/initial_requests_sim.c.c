/* NUCLEO-F446RE + TJA1050 + Teensy OBD-II simulator.
 * Replace Core/Src/main.c in a CubeIDE project configured as README describes.
 * Uses HSI (16 MHz), CAN1 at 500 kbps, USART2 at 115200 baud.
 */
#include "main.h"
#include <stdio.h>
#include <string.h>

CAN_HandleTypeDef hcan1;
UART_HandleTypeDef huart2;
void Error_Handler(void);

static void print_text(const char *s)
{
    HAL_UART_Transmit(&huart2, (uint8_t *)s, (uint16_t)strlen(s), 200);
}

static void clock_init(void)
{
    RCC_OscInitTypeDef osc = {0};
    RCC_ClkInitTypeDef clk = {0};
    /* Internal oscillator avoids dependency on ST-LINK clock jumpers. */
    osc.OscillatorType = RCC_OSCILLATORTYPE_HSI;
    osc.HSIState = RCC_HSI_ON;
    osc.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
    osc.PLL.PLLState = RCC_PLL_OFF;
    if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();
    clk.ClockType = RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_HCLK |
                    RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    clk.SYSCLKSource = RCC_SYSCLKSOURCE_HSI;
    clk.AHBCLKDivider = RCC_SYSCLK_DIV1;
    clk.APB1CLKDivider = RCC_HCLK_DIV1;
    clk.APB2CLKDivider = RCC_HCLK_DIV1;
    if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_0) != HAL_OK)
        Error_Handler();
}

static void peripherals_init(void)
{
    GPIO_InitTypeDef gpio = {0};
    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_CAN1_CLK_ENABLE();
    __HAL_RCC_USART2_CLK_ENABLE();

    /* PA11=CAN_RX, PA12=CAN_TX; NOT the Arduino D0/D1 UART pins. */
    gpio.Pin = GPIO_PIN_11 | GPIO_PIN_12;
    gpio.Mode = GPIO_MODE_AF_PP;
    gpio.Pull = GPIO_NOPULL;
    gpio.Speed = GPIO_SPEED_FREQ_VERY_HIGH;
    gpio.Alternate = GPIO_AF9_CAN1;
    HAL_GPIO_Init(GPIOA, &gpio);

    /* USART2 connects to the onboard ST-LINK virtual COM port. */
    gpio.Pin = GPIO_PIN_2 | GPIO_PIN_3;
    gpio.Alternate = GPIO_AF7_USART2;
    HAL_GPIO_Init(GPIOA, &gpio);
    huart2.Instance = USART2;
    huart2.Init.BaudRate = 115200;
    huart2.Init.WordLength = UART_WORDLENGTH_8B;
    huart2.Init.StopBits = UART_STOPBITS_1;
    huart2.Init.Parity = UART_PARITY_NONE;
    huart2.Init.Mode = UART_MODE_TX_RX;
    huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
    huart2.Init.OverSampling = UART_OVERSAMPLING_16;
    if (HAL_UART_Init(&huart2) != HAL_OK) Error_Handler();

    hcan1.Instance = CAN1;
    /* 16 MHz / (2 * (1 + 13 + 2)) = 500,000 bit/s. */
    hcan1.Init.Prescaler = 2;
    hcan1.Init.Mode = CAN_MODE_NORMAL;
    hcan1.Init.SyncJumpWidth = CAN_SJW_1TQ;
    hcan1.Init.TimeSeg1 = CAN_BS1_13TQ;
    hcan1.Init.TimeSeg2 = CAN_BS2_2TQ;
    hcan1.Init.TimeTriggeredMode = DISABLE;
    hcan1.Init.AutoBusOff = ENABLE;
    hcan1.Init.AutoWakeUp = DISABLE;
    hcan1.Init.AutoRetransmission = DISABLE;
    hcan1.Init.ReceiveFifoLocked = DISABLE;
    hcan1.Init.TransmitFifoPriority = DISABLE;
    if (HAL_CAN_Init(&hcan1) != HAL_OK) Error_Handler();
}

static void can_start(void)
{
    CAN_FilterTypeDef filter = {0};
    /* Accept all IDs; read_pid() selects matching OBD responses. */
    filter.FilterBank = 0;
    filter.FilterMode = CAN_FILTERMODE_IDMASK;
    filter.FilterScale = CAN_FILTERSCALE_32BIT;
    filter.FilterFIFOAssignment = CAN_RX_FIFO0;
    filter.FilterActivation = ENABLE;
    filter.SlaveStartFilterBank = 14;
    if (HAL_CAN_ConfigFilter(&hcan1, &filter) != HAL_OK ||
        HAL_CAN_Start(&hcan1) != HAL_OK) Error_Handler();
}

static void read_pid(uint8_t pid)
{
    CAN_TxHeaderTypeDef tx = {0};
    CAN_RxHeaderTypeDef rx;
    uint8_t data[8];
    uint8_t request[8] = {2, 1, pid, 0, 0, 0, 0, 0};
    uint32_t mailbox;
    char line[128];

    /* Discard stale frames before making this request. */
    while (HAL_CAN_GetRxFifoFillLevel(&hcan1, CAN_RX_FIFO0)) {
        if (HAL_CAN_GetRxMessage(&hcan1, CAN_RX_FIFO0, &rx, data)
            != HAL_OK) break;
    }
    tx.StdId = 0x7DF;             /* Functional OBD request ID */
    tx.IDE = CAN_ID_STD;
    tx.RTR = CAN_RTR_DATA;
    tx.DLC = 8;
    tx.TransmitGlobalTime = DISABLE;
    if (HAL_CAN_AddTxMessage(&hcan1, &tx, request, &mailbox) != HAL_OK) {
        print_text("Unable to queue CAN request\r\n");
        return;
    }

    uint32_t start = HAL_GetTick();
    while ((uint32_t)(HAL_GetTick() - start) < 300) {
        if (!HAL_CAN_GetRxFifoFillLevel(&hcan1, CAN_RX_FIFO0)) continue;
        if (HAL_CAN_GetRxMessage(&hcan1, CAN_RX_FIFO0, &rx, data)
            != HAL_OK) continue;
        if (rx.IDE != CAN_ID_STD || rx.RTR != CAN_RTR_DATA ||
            rx.StdId < 0x7E8 || rx.StdId > 0x7EF || rx.DLC < 4)
            continue;
        /* 0x41 = positive reply to Mode 01 (current sensor data). */
        if (data[1] != 0x41 || data[2] != pid) continue;
        if (pid == 0x0C && rx.DLC >= 5 && data[0] == 4) {
            unsigned int rpm = (((unsigned int)data[3] << 8) | data[4]) / 4;
            snprintf(line, sizeof(line), "RPM: %u\r\n", rpm);
            print_text(line);
            return;
        }
        if (pid == 0x0D && data[0] == 3) {
            snprintf(line, sizeof(line), "Speed: %u km/h\r\n",
                     (unsigned int)data[3]);
            print_text(line);
            return;
        }
    }
    HAL_CAN_AbortTxRequest(&hcan1, mailbox);
    snprintf(line, sizeof(line),
             "No reply PID 0x%02X; HAL error=0x%08lX ESR=0x%08lX\r\n",
             (unsigned int)pid, (unsigned long)HAL_CAN_GetError(&hcan1),
             (unsigned long)CAN1->ESR);
    print_text(line);
}

int main(void)
{
    HAL_Init();
    clock_init();
    peripherals_init();
    print_text("\r\nOBD simulator test: CAN1 500 kbps\r\n");
    can_start();
    while (1) {
        read_pid(0x0C);          /* RPM */
        HAL_Delay(100);
        read_pid(0x0D);          /* Speed */
        HAL_Delay(800);
    }
}

void Error_Handler(void)
{
    __disable_irq();
    while (1) { }               /* Set a debugger breakpoint here on failure. */
}
