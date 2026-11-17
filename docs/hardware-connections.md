# SecureGate AI — Hardware Connections & Electrical Engineering Guide

This guide details the physical wiring, electrical characteristics, power budgeting, and breadboard schematics for the **ESP32 DevKit**, **MFRC522 RFID Reader**, **Servo Motor**, **LEDs**, and **Buzzer**.

---

## 1. Master Pinout Table

| Module | Pin Name | ESP32 GPIO | Logic Level | Wire Color | Function / Electrical Notes |
|---|---|---|---|---|---|
| **RC522 RFID** | **3.3V / VCC** | **3V3** | **3.3V ONLY** | Red | **CRITICAL:** Do NOT connect to 5V! Draws ~13–26mA. |
| **RC522 RFID** | **GND** | **GND** | 0V | Black | System ground. |
| **RC522 RFID** | **RST** | **GPIO 22** | 3.3V Logic | Orange | Hardware reset pin. |
| **RC522 RFID** | **SDA / SS** | **GPIO 5** | 3.3V Logic | Yellow | SPI Chip Select (Active Low). |
| **RC522 RFID** | **MOSI** | **GPIO 23** | 3.3V Logic | Green | SPI Master-Out-Slave-In. |
| **RC522 RFID** | **MISO** | **GPIO 19** | 3.3V Logic | Blue | SPI Master-In-Slave-Out. |
| **RC522 RFID** | **SCK** | **GPIO 18** | 3.3V Logic | Purple | SPI Serial Clock. |
| **RC522 RFID** | **IRQ** | *NC* | — | — | Leave floating / unconnected. |
| **Green LED** | Anode (+) | **GPIO 2** | 3.3V Logic | Green | In series with 220Ω resistor (~8mA). |
| **Green LED** | Cathode (-) | **GND** | 0V | Black | Ground rail. |
| **Red LED** | Anode (+) | **GPIO 4** | 3.3V Logic | Red | In series with 220Ω resistor (~8mA). |
| **Red LED** | Cathode (-) | **GND** | 0V | Black | Ground rail. |
| **Piezo Buzzer** | Positive (+) | **GPIO 15** | 3.3V Logic | White | Active/Passive buzzer (<15mA). |
| **Piezo Buzzer** | Negative (-) | **GND** | 0V | Black | Ground rail. |
| **Servo Motor** | PWM Signal | **GPIO 13** | 3.3V PWM | Orange | 50Hz PWM control signal (500–2400µs). |
| **Servo Motor** | VCC (+) | **VIN / 5V** | 5.0V | Red | External 5V rail or VIN (See power note!). |
| **Servo Motor** | GND (-) | **GND** | 0V | Black | Common Ground rail. |

---

## 2. Electrical Safety & Current Budgeting

### 2.1. Critical RC522 3.3V Notice
The NXP MFRC522 IC is strictly rated for **2.5V to 3.6V**. 
Connecting the RFID reader's `3.3V` pin to the ESP32 `VIN` / `5V` pin will **destroy the RF front-end receiver immediately**. Always double-check that the red wire connects to the pin labeled `3V3`.

### 2.2. Servo Motor Current Spike Protection
A micro-servo (e.g., TowerPro SG90) or standard servo (MG995) draws:
- **Idle Current:** ~10mA–20mA
- **Operating Current:** ~150mA–250mA
- **Stall / Inrush Current:** **500mA–800mA**

If you attempt to power the servo directly from the ESP32's `3V3` regulator, the voltage will brown out, causing the ESP32 to reset in an endless boot loop.
- **Option A (USB Powered):** Connect the servo VCC to the ESP32 `VIN` pin (which directly supplies 5V from the USB host).
- **Option B (Recommended for College Demos):** Power the servo from an external 5V 1A/2A DC power supply or 4xAA battery pack. **You MUST tie the external power supply GND directly to the ESP32 GND** to establish a common reference voltage!

---

## 3. Visual Breadboard Schematic

```text
       +--------------------------------------------------------------+
       |                     ESP32 DEVKIT (30/38P)                    |
       |                                                              |
       |  [ 3V3 ] -------------------------------+                    |
       |  [ GND ] ------------------------+      |                    |
       |                                  |      |                    |
       |  [GPIO  5] ------------+         |      |                    |
       |  [GPIO 18] ---------+  |         |      |                    |
       |  [GPIO 19] ------+  |  |         |      |                    |
       |  [GPIO 23] ---+  |  |  |         |      |                    |
       |  [GPIO 22] +  |  |  |  |         |      |                    |
       |            |  |  |  |  |         |      |                    |
       |            v  v  v  v  v         v      v                    |
       |          +-------------------------------+                   |
       |          |      RC522 RFID READER        |                   |
       |          | RST MOSI MISO SCK SDA GND 3V3 |                   |
       |          +-------------------------------+                   |
       |                                                              |
       |  [GPIO  2] -----[ 220Ω Resistor ]---> [ Green LED + ] -> GND |
       |  [GPIO  4] -----[ 220Ω Resistor ]---> [  Red LED  + ] -> GND |
       |  [GPIO 15] -------------------------> [  Buzzer   + ] -> GND |
       |                                                              |
       |  [GPIO 13] -------------------------> Servo Signal (Orange)  |
       |  [  VIN  ] -------------------------> Servo Power  (Red)     |
       |  [  GND  ] -------------------------> Servo Ground (Brown)   |
       +--------------------------------------------------------------+
```

---

## 4. Hardware Troubleshooting Checklist

1. **RC522 Version shows 0x00 or 0xFF in Serial Monitor:**
   - Usually caused by loose SPI wiring. Check `GPIO 18 (SCK)`, `GPIO 19 (MISO)`, and `GPIO 23 (MOSI)`.
   - Ensure the RFID module is receiving stable 3.3V.

2. **ESP32 reboots when Servo turns:**
   - Insufficient current on the 5V rail. Use a high-quality USB cable, connect directly to a PC motherboard USB port (or powered USB hub), or connect a 470µF electrolytic capacitor across the servo `5V` and `GND` rails.

3. **Servo Jitter:**
   - The firmware uses the standard 50Hz PWM frequency configured through `ESP32Servo`. Ensure signal wire connects to `GPIO 13`.

