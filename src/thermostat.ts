import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  Characteristic,
  CharacteristicValue,
  Logging,
  Service,
} from "homebridge";

import mqtt, { MqttClient } from "mqtt";

interface Temperature {
  battery: number;
  humidity: number;
  linkquality: number;
  pressure: number;
  temperature: number;
  voltage: number;
}

interface AccessoryState extends Pick<Temperature, "temperature" | "humidity"> {
  targetTemperature: CharacteristicValue;
  currentHeaterState: CharacteristicValue;
  targetHeatingState: CharacteristicValue;
}

class Thermostat implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly name: string;
  private readonly config: AccessoryConfig;

  private readonly service: Service;
  private readonly informationService: Service;

  private characteristic: typeof Characteristic;

  private readonly mqttClient: MqttClient;

  private state: AccessoryState = {
    temperature: 0,
    humidity: 0,
    targetTemperature: 20,
    currentHeaterState: 0,
    targetHeatingState: 0,
  };

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;
    this.config = config;

    this.service = new api.hap.Service.Thermostat(this.name);
    this.characteristic = api.hap.Characteristic;

    this.mqttClient = mqtt.connect(config.mqtt.url);
    this.mqttClient.on("error", (error) => {
      log.error("MQTT error", error);
    });

    this.mqttClient.on("connect", () => {
      this.mqttClient.subscribe(this.topic(config.temperature));

      this.mqttClient.on("message", (topic, msg) => {
        const message = JSON.parse(msg.toString()) as Temperature;
        this.state.humidity = message.humidity;
        this.state.temperature = message.temperature;
        this.update();
      });
    });

    this.service
      .getCharacteristic(this.characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.state.currentHeaterState);

    this.service
      .getCharacteristic(this.characteristic.TargetHeatingCoolingState)
      .setProps({
        minValue: 0,
        maxValue: 1,
        validValues: [0, 1],
      })
      .onGet(() => this.state.targetHeatingState)
      .onSet((value) => {
        this.state.targetHeatingState = value;
        this.update();
      });

    this.service
      .getCharacteristic(this.characteristic.CurrentTemperature)
      .onGet(() => this.state.temperature);

    this.service
      .getCharacteristic(this.characteristic.TargetTemperature)
      .onGet(() => this.state.targetTemperature)
      .onSet((value) => {
        this.state.targetTemperature = value;
        this.update();
      });

    this.service
      .getCharacteristic(this.characteristic.CurrentRelativeHumidity)
      .onGet(() => this.state.humidity);

    this.service.getCharacteristic(this.characteristic.TemperatureDisplayUnits);

    this.informationService = new api.hap.Service.AccessoryInformation()
      .setCharacteristic(
        this.characteristic.Manufacturer,
        "Custom Manufacturer"
      )
      .setCharacteristic(this.characteristic.Model, "Custom Model");

    log.info("Switch finished initializing!");
  }

  topic(value: string) {
    return `${this.config.mqtt.base_topic || "zigbee2mqtt"}/${value}`;
  }

  toSwitchValue(value: CharacteristicValue) {
    return value === 0 ? "OFF" : "ON";
  }

  update(): void {
    this.log.debug("Updating", this.state);

    this.service
      .getCharacteristic(this.characteristic.CurrentTemperature)
      .updateValue(this.state.temperature);
    this.service
      .getCharacteristic(this.characteristic.CurrentRelativeHumidity)
      .updateValue(this.state.humidity);

    if (this.state.targetHeatingState) {
      const newHeaterState =
        this.state.temperature > this.state.targetTemperature;
      this.state.currentHeaterState = newHeaterState ? 0 : 1;
    } else {
      this.state.currentHeaterState = 0;
    }

    this.mqttClient.publish(
      this.topic(this.config.switch) + "/set",
      JSON.stringify({
        state: this.toSwitchValue(this.state.currentHeaterState),
      }),
      (e) => {
        if (!e) {
          this.service
            .getCharacteristic(this.characteristic.CurrentHeatingCoolingState)
            .updateValue(this.state.currentHeaterState);
        }
      }
    );
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Identify!");
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [this.informationService, this.service];
  }
}

export default Thermostat;
