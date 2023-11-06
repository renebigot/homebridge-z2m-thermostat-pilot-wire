import {
  API,
  AccessoryConfig,
  AccessoryPlugin,
  Characteristic,
  CharacteristicValue,
  Logging,
  Service,
} from "homebridge";
import { MqttClient, connect } from "mqtt";

interface Temperature {
  battery: number;
  humidity: number;
  linkquality: number;
  pressure: number;
  temperature: number;
  voltage: number;
}

interface AccessoryState {
  currentTemperature: number;
  targetTemperature: number;
  currentHeatingCoolingState: CharacteristicValue;
  targetHeatingCoolingState: CharacteristicValue;
}

class Thermostat implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly config: AccessoryConfig;
  private readonly service: Service;
  private readonly informationService: Service;
  private readonly mqttClient: MqttClient;

  private characteristic: typeof Characteristic;
  private state: AccessoryState = {
    currentTemperature: 0,
    targetTemperature: 20,
    currentHeatingCoolingState: 0,
    targetHeatingCoolingState: 0,
  };

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.config = config;
    this.service = new api.hap.Service.Thermostat(config.name);
    this.characteristic = api.hap.Characteristic;

    let url = "mqtt://";
    if (config.mqtt.user) {
      url += config.mqtt.user;
      if (config.mqtt.password) {
        url += `:${config.mqtt.password}`;
      }
      url += "@";
    }
    url += `${config.mqtt.address}:${config.mqtt.port}`;

    log.info(`Connecting to ${url.replace(/\/\/.*?:.*?@/, "//")}`);
    this.mqttClient = connect(url);

    this.mqttClient.on("error", (error) => {
      log.error("MQTT error", error);
    });

    this.mqttClient.on("connect", () => {
      const topic = this.topic(config.temperature);
      log.info(`Subscribe to: ${topic}`);
      this.mqttClient.subscribe(topic);
    });

    this.mqttClient.on("message", (topic, msg) => {
      const message = JSON.parse(msg.toString());
      const { temperature } = message as Temperature;
      this.state.currentTemperature = temperature;

      this.log.info(`Room temperature is "${temperature}°C"`);
      this.service.setCharacteristic(this.characteristic.CurrentTemperature, this.state.currentTemperature);
      // Update HeatingCoolingState based on current temperature and target
      this.updateHeatingCoolingState();
    });

    this.service
      .getCharacteristic(this.characteristic.CurrentTemperature)
      .onGet(() => this.state.currentTemperature);

    this.service
      .getCharacteristic(this.characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.state.currentHeatingCoolingState);

    this.service
      .getCharacteristic(this.characteristic.TargetHeatingCoolingState)
      .setProps({
        minValue: 0,
        maxValue: 1,
        validValues: [0, 1],
      })
      .onGet(() => this.state.targetHeatingCoolingState)
      .onSet((value) => {
        this.log.info(`Setting TargetHeatingCoolingState to "${value}"`);
        this.state.targetHeatingCoolingState = value;

        if (value === this.characteristic.TargetHeatingCoolingState.OFF) {
          this.updateOutletState(value);
        }
      });

    this.service
      .getCharacteristic(this.characteristic.TargetTemperature)
      .setProps({
        minValue: 10,
        maxValue: 30,
        minStep: 0.5,
      })
      .onGet(() => this.state.targetTemperature)
      .onSet((value) => {
        this.log.info(`Setting TargetTemperature to "${value}°C"`);
        this.state.targetTemperature = value as number;
        this.updateHeatingCoolingState();
      });

    this.service.getCharacteristic(this.characteristic.TemperatureDisplayUnits);

    this.informationService = new api.hap.Service.AccessoryInformation()
      .setCharacteristic(
        this.characteristic.Manufacturer,
        "Custom Manufacturer"
      )
      .setCharacteristic(this.characteristic.Model, "Custom Model");

    log.info("Thermostat finished initializing!");
  }

  async updateHeatingCoolingState() {
    if (this.state.targetHeatingCoolingState === this.characteristic.TargetHeatingCoolingState.OFF) {
      this.log.info("Operation cancelled : TargetHeatingCoolingState is \"OFF\"");
      return;
    }

    if (this.state.currentTemperature >= this.state.targetTemperature + 0.5) {
      if (this.state.currentHeatingCoolingState !== this.characteristic.CurrentHeatingCoolingState.OFF) {
        this.log.info("Setting CurrentHeatingCoolingState to \"OFF\"");
        this.state.currentHeatingCoolingState = this.characteristic.CurrentHeatingCoolingState.OFF;
        this.updateOutletState(this.characteristic.CurrentHeatingCoolingState.OFF);
      }
    } else if (this.state.currentTemperature < this.state.targetTemperature - 0.5) {
      if (this.state.currentHeatingCoolingState !== this.characteristic.CurrentHeatingCoolingState.HEAT) {
        this.log.info("Setting CurrentHeatingCoolingState to \"HEAT\"");
        this.state.currentHeatingCoolingState = this.characteristic.CurrentHeatingCoolingState.HEAT;
        this.updateOutletState(this.characteristic.CurrentHeatingCoolingState.HEAT);
      }
    }

    this.service.setCharacteristic(this.characteristic.CurrentHeatingCoolingState, this.state.currentHeatingCoolingState);
  }

  topic(value: string) {
    return `${this.config.mqtt.baseTopic || "zigbee2mqtt"}/${value}`;
  }

  updateOutletState(value: CharacteristicValue): Promise<CharacteristicValue> {
    const _value = this.config.invertOnOff === false ? value === 1 : value === 0;
    const state = _value ? "ON" : "OFF";

    const topic = this.topic(this.config.outlet) + "/set";
    this.log.info(`Sending "${state}" to topic "${topic}"`);

    return new Promise((resolve, reject) => {
      this.mqttClient.publish(
        topic,
        JSON.stringify({ state }),
        { qos: 2 },
        (error) => {
          if (error) {
            return reject(error);
          }
          return resolve(value);
        }
      );
    });
  }

  getServices(): Service[] {
    return [this.informationService, this.service];
  }
}

export default Thermostat;
