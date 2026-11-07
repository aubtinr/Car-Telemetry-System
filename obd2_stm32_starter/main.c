/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2026 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdio.h>
#include <string.h>
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */
/* Reassembly state for one ECU's multi-frame (ISO-TP) response. */
typedef struct
{
  uint8_t active;
  uint16_t total_len;
  uint16_t rx_len;
  uint8_t next_sn;
  uint8_t buf[70];
} isotp_rx_t;
/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
#define OBD_RESPONSE_TIMEOUT_MS 50U  /* ISO 15765-4 P2CAN max */
#define FRAME_MIN_PERIOD_MS 50U      /* caps the frame rate at 20 Hz */
#define DTC_PERIOD_MS 5000U
#define DTC_TIMEOUT_MS 100U          /* wait this long after the last DTC reply */
#define DTC_MAX 32U
#define OBD_ECU_COUNT 8U             /* response IDs 0x7E8..0x7EF */
/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/

/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/

CAN_HandleTypeDef hcan1;

UART_HandleTypeDef huart2;

/* USER CODE BEGIN PV */

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_CAN1_Init(void);
static void MX_USART2_UART_Init(void);
/* USER CODE BEGIN PFP */

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */
static const uint8_t obd_pids[] = {0x0C, 0x0D, 0x05, 0x10, 0x11, 0x14};
static const uint8_t obd_pid_data_lengths[] = {2, 1, 1, 2, 1, 2};

static uint8_t can_start(void)
{
  CAN_FilterTypeDef filter = {0};

  filter.FilterBank = 0;
  filter.FilterMode = CAN_FILTERMODE_IDMASK;
  filter.FilterScale = CAN_FILTERSCALE_32BIT;
  filter.FilterFIFOAssignment = CAN_RX_FIFO0;
  filter.FilterActivation = ENABLE;
  filter.SlaveStartFilterBank = 14;

  if (HAL_CAN_ConfigFilter(&hcan1, &filter) != HAL_OK)
  {
    return 0;
  }

  return HAL_CAN_Start(&hcan1) == HAL_OK;
}

static uint8_t read_pid(uint8_t pid, uint8_t data_length, uint8_t raw_data[2])
{
  CAN_TxHeaderTypeDef tx = {0};
  CAN_RxHeaderTypeDef rx;
  uint8_t data[8] = {0};
  uint8_t request[8] = {2, 1, pid, 0, 0, 0, 0, 0};
  uint32_t mailbox;
  uint32_t start;

  while (HAL_CAN_GetRxFifoFillLevel(&hcan1, CAN_RX_FIFO0) > 0U)
  {
    if (HAL_CAN_GetRxMessage(&hcan1, CAN_RX_FIFO0, &rx, data) != HAL_OK)
    {
      break;
    }
  }

  tx.StdId = 0x7DF;
  tx.IDE = CAN_ID_STD;
  tx.RTR = CAN_RTR_DATA;
  tx.DLC = 8;
  tx.TransmitGlobalTime = DISABLE;
  if (HAL_CAN_AddTxMessage(&hcan1, &tx, request, &mailbox) != HAL_OK)
  {
    return 0;
  }

  start = HAL_GetTick();
  while ((uint32_t)(HAL_GetTick() - start) < OBD_RESPONSE_TIMEOUT_MS)
  {
    if (HAL_CAN_GetRxFifoFillLevel(&hcan1, CAN_RX_FIFO0) == 0U)
    {
      continue;
    }
    if (HAL_CAN_GetRxMessage(&hcan1, CAN_RX_FIFO0, &rx, data) != HAL_OK)
    {
      continue;
    }
    if (rx.IDE != CAN_ID_STD || rx.RTR != CAN_RTR_DATA ||
      rx.StdId < 0x7E8U || rx.StdId > 0x7EFU ||
      rx.DLC < (uint32_t)(data_length + 3U))
    {
      continue;
    }
    if (data[0] != (uint8_t)(data_length + 2U) ||
      data[1] != 0x41U || data[2] != pid)
    {
      continue;
    }

    memcpy(raw_data, &data[3], data_length);
    return 1;
  }

  HAL_CAN_AbortTxRequest(&hcan1, mailbox);
  return 0;
}

static void emit_frame(uint32_t seq,
             uint32_t uptime_ms,
             const uint8_t responses[6][2],
             const uint8_t received[6])
{
  char line[256];
  int written;
  size_t used;
  uint8_t first;

  written = snprintf(line, sizeof(line),
             "{\"type\":\"obd_raw\",\"v\":1,\"seq\":%lu,"
             "\"uptime_ms\":%lu,\"pids\":{",
             (unsigned long)seq, (unsigned long)uptime_ms);
  if (written < 0 || (size_t)written >= sizeof(line))
  {
    return;
  }
  used = (size_t)written;
  first = 1U;

  for (size_t i = 0; i < sizeof(obd_pids); i++)
  {
    if (received[i] == 0U)
    {
      continue;
    }

    if (obd_pid_data_lengths[i] == 1U)
    {
      written = snprintf(&line[used], sizeof(line) - used,
                 "%s\"%02X\":\"%02X\"",
                 first ? "" : ",",
                 (unsigned int)obd_pids[i],
                 (unsigned int)responses[i][0]);
    }
    else
    {
      written = snprintf(&line[used], sizeof(line) - used,
                 "%s\"%02X\":\"%02X%02X\"",
                 first ? "" : ",",
                 (unsigned int)obd_pids[i],
                 (unsigned int)responses[i][0],
                 (unsigned int)responses[i][1]);
    }
    if (written < 0 || (size_t)written >= sizeof(line) - used)
    {
      return;
    }
    used += (size_t)written;
    first = 0U;
  }

  written = snprintf(&line[used], sizeof(line) - used, "},\"no_response\":[");
  if (written < 0 || (size_t)written >= sizeof(line) - used)
  {
    return;
  }
  used += (size_t)written;
  first = 1U;

  for (size_t i = 0; i < sizeof(obd_pids); i++)
  {
    if (received[i] != 0U)
    {
      continue;
    }
    written = snprintf(&line[used], sizeof(line) - used,
               "%s\"%02X\"", first ? "" : ",",
               (unsigned int)obd_pids[i]);
    if (written < 0 || (size_t)written >= sizeof(line) - used)
    {
      return;
    }
    used += (size_t)written;
    first = 0U;
  }

  written = snprintf(&line[used], sizeof(line) - used, "]}\n");
  if (written < 0 || (size_t)written >= sizeof(line) - used)
  {
    return;
  }
  used += (size_t)written;
  HAL_UART_Transmit(&huart2, (uint8_t *)line, (uint16_t)used, 200U);
}

/* payload: 0x43, DTC count, then two bytes per DTC (0x0000 = padding). */
static void add_dtcs(const uint8_t *payload, uint16_t len,
           uint16_t dtcs[DTC_MAX], uint8_t *dtc_count)
{
  for (uint16_t i = 2U; (uint16_t)(i + 1U) < len; i += 2U)
  {
    const uint16_t dtc = (uint16_t)((payload[i] << 8) | payload[i + 1U]);
    uint8_t seen = 0U;

    if (dtc == 0U)
    {
      continue;
    }
    for (uint8_t j = 0U; j < *dtc_count; j++)
    {
      if (dtcs[j] == dtc)
      {
        seen = 1U;
        break;
      }
    }
    if (seen == 0U && *dtc_count < DTC_MAX)
    {
      dtcs[(*dtc_count)++] = dtc;
    }
  }
}

static void send_flow_control(uint32_t ecu_request_id)
{
  CAN_TxHeaderTypeDef tx = {0};
  uint8_t fc[8] = {0x30, 0, 0, 0, 0, 0, 0, 0};  /* clear to send, no block limit, no gap */
  uint32_t mailbox;

  tx.StdId = ecu_request_id;
  tx.IDE = CAN_ID_STD;
  tx.RTR = CAN_RTR_DATA;
  tx.DLC = 8;
  tx.TransmitGlobalTime = DISABLE;
  (void)HAL_CAN_AddTxMessage(&hcan1, &tx, fc, &mailbox);
}

/* Mode 03: collect stored DTCs from every ECU that answers.
   Returns the number of ECUs that sent a complete response. */
static uint8_t read_dtcs(uint16_t dtcs[DTC_MAX], uint8_t *dtc_count)
{
  static isotp_rx_t isotp[OBD_ECU_COUNT];
  CAN_TxHeaderTypeDef tx = {0};
  CAN_RxHeaderTypeDef rx;
  uint8_t data[8] = {0};
  uint8_t request[8] = {1, 3, 0, 0, 0, 0, 0, 0};
  uint32_t mailbox;
  uint32_t last_activity;
  uint8_t responded = 0U;

  *dtc_count = 0U;
  memset(isotp, 0, sizeof(isotp));

  while (HAL_CAN_GetRxFifoFillLevel(&hcan1, CAN_RX_FIFO0) > 0U)
  {
    if (HAL_CAN_GetRxMessage(&hcan1, CAN_RX_FIFO0, &rx, data) != HAL_OK)
    {
      break;
    }
  }

  tx.StdId = 0x7DF;
  tx.IDE = CAN_ID_STD;
  tx.RTR = CAN_RTR_DATA;
  tx.DLC = 8;
  tx.TransmitGlobalTime = DISABLE;
  if (HAL_CAN_AddTxMessage(&hcan1, &tx, request, &mailbox) != HAL_OK)
  {
    return 0U;
  }

  last_activity = HAL_GetTick();
  while ((uint32_t)(HAL_GetTick() - last_activity) < DTC_TIMEOUT_MS)
  {
    uint8_t pci;
    isotp_rx_t *s;

    if (HAL_CAN_GetRxFifoFillLevel(&hcan1, CAN_RX_FIFO0) == 0U)
    {
      continue;
    }
    if (HAL_CAN_GetRxMessage(&hcan1, CAN_RX_FIFO0, &rx, data) != HAL_OK)
    {
      continue;
    }
    if (rx.IDE != CAN_ID_STD || rx.RTR != CAN_RTR_DATA ||
      rx.StdId < 0x7E8U || rx.StdId > 0x7EFU)
    {
      continue;
    }

    s = &isotp[rx.StdId - 0x7E8U];
    pci = (uint8_t)(data[0] >> 4);

    if (pci == 0U)  /* single frame: up to 2 DTCs */
    {
      const uint8_t len = (uint8_t)(data[0] & 0x0FU);

      if (len >= 2U && len <= 7U && rx.DLC >= (uint32_t)(len + 1U) &&
        data[1] == 0x43U)
      {
        add_dtcs(&data[1], len, dtcs, dtc_count);
        responded++;
        last_activity = HAL_GetTick();
      }
    }
    else if (pci == 1U && rx.DLC == 8U && data[2] == 0x43U)  /* first frame */
    {
      s->active = 1U;
      s->total_len = (uint16_t)(((data[0] & 0x0FU) << 8) | data[1]);
      memcpy(s->buf, &data[2], 6U);
      s->rx_len = 6U;
      s->next_sn = 1U;
      send_flow_control(rx.StdId - 8U);
      last_activity = HAL_GetTick();
    }
    else if (pci == 2U && rx.DLC == 8U && s->active != 0U &&
         (data[0] & 0x0FU) == s->next_sn)  /* consecutive frame */
    {
      for (uint8_t i = 1U; i < 8U && s->rx_len < s->total_len; i++)
      {
        if (s->rx_len < sizeof(s->buf))
        {
          s->buf[s->rx_len] = data[i];
        }
        s->rx_len++;
      }
      s->next_sn = (uint8_t)((s->next_sn + 1U) & 0x0FU);
      last_activity = HAL_GetTick();

      if (s->rx_len >= s->total_len)
      {
        add_dtcs(s->buf,
             (s->total_len < sizeof(s->buf)) ? s->total_len : (uint16_t)sizeof(s->buf),
             dtcs, dtc_count);
        responded++;
        s->active = 0U;
      }
    }
  }

  return responded;
}

static void emit_dtc_frame(uint32_t uptime_ms,
               uint8_t responded,
               const uint16_t dtcs[DTC_MAX],
               uint8_t dtc_count)
{
  char line[320];
  int written;
  size_t used;

  written = snprintf(line, sizeof(line),
             "{\"type\":\"obd_dtc\",\"v\":1,\"uptime_ms\":%lu,"
             "\"responded\":%u,\"codes\":[",
             (unsigned long)uptime_ms, (unsigned int)responded);
  if (written < 0 || (size_t)written >= sizeof(line))
  {
    return;
  }
  used = (size_t)written;

  for (uint8_t i = 0U; i < dtc_count; i++)
  {
    written = snprintf(&line[used], sizeof(line) - used,
               "%s\"%04X\"", (i == 0U) ? "" : ",",
               (unsigned int)dtcs[i]);
    if (written < 0 || (size_t)written >= sizeof(line) - used)
    {
      return;
    }
    used += (size_t)written;
  }

  written = snprintf(&line[used], sizeof(line) - used, "]}\n");
  if (written < 0 || (size_t)written >= sizeof(line) - used)
  {
    return;
  }
  used += (size_t)written;
  HAL_UART_Transmit(&huart2, (uint8_t *)line, (uint16_t)used, 200U);
}
/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{

  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_CAN1_Init();
  MX_USART2_UART_Init();
  /* USER CODE BEGIN 2 */
  const uint8_t can_ready = can_start();
  uint32_t seq = 0;
  uint32_t last_dtc_ms = HAL_GetTick() - DTC_PERIOD_MS;  /* first check runs immediately */

  /* USER CODE END 2 */

  /* Initialize leds */
  BSP_LED_Init(LED2);

  /* Initialize USER push-button, will be used to trigger an interrupt each time it's pressed.*/
  BSP_PB_Init(BUTTON_USER, BUTTON_MODE_EXTI);

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {

    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
    uint8_t responses[6][2] = {{0}};
    uint8_t received[6] = {0};
    const uint32_t cycle_start = HAL_GetTick();

    if (can_ready != 0U)
    {
      for (size_t i = 0; i < sizeof(obd_pids); i++)
      {
        received[i] = read_pid(obd_pids[i], obd_pid_data_lengths[i], responses[i]);
      }
    }

    emit_frame(seq++, HAL_GetTick(), responses, received);

    if ((uint32_t)(HAL_GetTick() - last_dtc_ms) >= DTC_PERIOD_MS)
    {
      uint16_t dtcs[DTC_MAX];
      uint8_t dtc_count = 0U;
      const uint8_t responded = (can_ready != 0U) ? read_dtcs(dtcs, &dtc_count) : 0U;

      last_dtc_ms = HAL_GetTick();
      emit_dtc_frame(HAL_GetTick(), responded, dtcs, dtc_count);
    }

    while ((uint32_t)(HAL_GetTick() - cycle_start) < FRAME_MIN_PERIOD_MS)
    {
    }
  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Configure the main internal regulator output voltage
  */
  __HAL_RCC_PWR_CLK_ENABLE();
  __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE3);

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_NONE;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_HSI;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV1;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_0) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief CAN1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_CAN1_Init(void)
{

  /* USER CODE BEGIN CAN1_Init 0 */

  /* USER CODE END CAN1_Init 0 */

  /* USER CODE BEGIN CAN1_Init 1 */

  /* USER CODE END CAN1_Init 1 */
  hcan1.Instance = CAN1;
  hcan1.Init.Prescaler = 2;
  hcan1.Init.Mode = CAN_MODE_NORMAL;
  hcan1.Init.SyncJumpWidth = CAN_SJW_1TQ;
  hcan1.Init.TimeSeg1 = CAN_BS1_13TQ;
  hcan1.Init.TimeSeg2 = CAN_BS2_2TQ;
  hcan1.Init.TimeTriggeredMode = DISABLE;
  hcan1.Init.AutoBusOff = DISABLE;
  hcan1.Init.AutoWakeUp = DISABLE;
  hcan1.Init.AutoRetransmission = DISABLE;
  hcan1.Init.ReceiveFifoLocked = DISABLE;
  hcan1.Init.TransmitFifoPriority = DISABLE;
  if (HAL_CAN_Init(&hcan1) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN CAN1_Init 2 */

  /* USER CODE END CAN1_Init 2 */

}

/**
  * @brief USART2 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART2_UART_Init(void)
{

  /* USER CODE BEGIN USART2_Init 0 */

  /* USER CODE END USART2_Init 0 */

  /* USER CODE BEGIN USART2_Init 1 */

  /* USER CODE END USART2_Init 1 */
  huart2.Instance = USART2;
  huart2.Init.BaudRate = 115200;
  huart2.Init.WordLength = UART_WORDLENGTH_8B;
  huart2.Init.StopBits = UART_STOPBITS_1;
  huart2.Init.Parity = UART_PARITY_NONE;
  huart2.Init.Mode = UART_MODE_TX_RX;
  huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart2.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart2) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN USART2_Init 2 */

  /* USER CODE END USART2_Init 2 */

}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  /* USER CODE BEGIN MX_GPIO_Init_1 */

  /* USER CODE END MX_GPIO_Init_1 */

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOC_CLK_ENABLE();
  __HAL_RCC_GPIOH_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /* USER CODE BEGIN MX_GPIO_Init_2 */

  /* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */

/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}
#ifdef USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
