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

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

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
static void print_text(const char *s)
{
    HAL_UART_Transmit(&huart2, (uint8_t *)s,
                      (uint16_t)strlen(s), 200);
}

static void can_start(void)
{
    CAN_FilterTypeDef filter = {0};
    char msg[100];

    filter.FilterBank = 0;
    filter.FilterMode = CAN_FILTERMODE_IDMASK;
    filter.FilterScale = CAN_FILTERSCALE_32BIT;
    filter.FilterFIFOAssignment = CAN_RX_FIFO0;
    filter.FilterActivation = ENABLE;
    filter.SlaveStartFilterBank = 14;

    print_text("Configuring CAN filter...\r\n");

    HAL_StatusTypeDef status = HAL_CAN_ConfigFilter(&hcan1, &filter);

    if (status != HAL_OK)
    {
        snprintf(msg, sizeof(msg),
                 "CAN filter FAILED: status=%d error=0x%08lX\r\n",
                 (int)status,
                 (unsigned long)HAL_CAN_GetError(&hcan1));
        print_text(msg);
        return;
    }

    print_text("CAN filter configured!\r\n");
    print_text("Starting CAN peripheral...\r\n");

    status = HAL_CAN_Start(&hcan1);

    if (status != HAL_OK)
    {
        snprintf(msg, sizeof(msg),
                 "CAN start FAILED: status=%d error=0x%08lX\r\n",
                 (int)status,
                 (unsigned long)HAL_CAN_GetError(&hcan1));
        print_text(msg);
        return;
    }

    print_text("CAN started successfully!\r\n");
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
  char msg[100];

  snprintf(msg, sizeof(msg),
           "CAN state=%d, error=0x%08lX\r\n",
           (int)HAL_CAN_GetState(&hcan1),
           (unsigned long)HAL_CAN_GetError(&hcan1));

  print_text(msg);
  print_text("\r\nOBD simulator test: CAN1 500 kbps\r\n");
  print_text("Starting CAN...\r\n");
  can_start();
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
	read_pid(0x0C);   // Engine RPM
	HAL_Delay(100);

	read_pid(0x0D);   // Vehicle speed
	HAL_Delay(800);
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
  hcan1.Init.AutoBusOff = DISABLE; // TODO: may want to change later
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
