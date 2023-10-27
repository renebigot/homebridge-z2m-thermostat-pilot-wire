import {
  API,
  AccessoryConfig,
  AccessoryPlugin,
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
  private readonly config: AccessoryConfig;
  private readonly service: Service;
  private readonly informationService: Service;
  private readonly mqttClient: MqttClient;

  private characteristic: typeof Characteristic;
  private state: AccessoryState = {
    temperature: 0,
    humidity: 0,
    targetTemperature: 20,
    currentHeaterState: 0,
    targetHeatingState: 0,
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

    this.mqttClient = mqtt.connect(url);

    this.mqttClient.on("error", (error) => {
      log.error("MQTT error", error);
    });

    this.mqttClient.on("connect", () => {
      this.mqttClient.subscribe(this.topic(config.temperature));
    });

    this.mqttClient.on("message", (topic, msg) => {
      const message = JSON.parse(msg.toString());
      const { humidity, temperature } = message as Temperature;
      this.setState({ humidity, temperature });
    });

    this.service
      .getCharacteristic(this.characteristic.CurrentTemperature)
      .onGet(() => this.state.temperature);

    this.service
      .getCharacteristic(this.characteristic.CurrentRelativeHumidity)
      .onGet(() => this.state.humidity);

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
      .onSet((value) => this.setState({ targetHeatingState: value }));

    this.service
      .getCharacteristic(this.characteristic.TargetTemperature)
      .onGet(() => this.state.targetTemperature)
      .onSet((value) => this.setState({ targetTemperature: value }));

    this.service.getCharacteristic(this.characteristic.TemperatureDisplayUnits);

    this.informationService = new api.hap.Service.AccessoryInformation()
      .setCharacteristic(
        this.characteristic.Manufacturer,
        "Custom Manufacturer"
      )
      .setCharacteristic(this.characteristic.Model, "Custom Model");

    log.info("Thermostat finished initializing!");
  }

  async setState(state: Partial<AccessoryState>) {
    const oldState = { ...this.state };
    const newState = { ...oldState, ...state };
    const targetTemperatureReached = newState.temperature > (newState.targetTemperature as number);
    if (newState.targetHeatingState === 0) {
      newState.currentHeaterState = 0;
    } else {
      newState.currentHeaterState = targetTemperatureReached ? 0 : 1;
    }

    this.state = newState;
    await this.update(newState, oldState);
  }

  async update(state: AccessoryState, oldState: AccessoryState) {
    this.service
      .getCharacteristic(this.characteristic.CurrentTemperature)
      .updateValue(state.temperature);
    this.service
      .getCharacteristic(this.characteristic.CurrentRelativeHumidity)
      .updateValue(state.humidity);
    this.service
      .getCharacteristic(this.characteristic.CurrentHeatingCoolingState)
      .updateValue(state.currentHeaterState);

    const outletState = this.outletState(state);
    if (outletState !== this.outletState(oldState)) {
      await this.updateOutletState(outletState);
    }
  }

  topic(value: string) {
    return `${this.config.mqtt.baseTopic || "zigbee2mqtt"}/${value}`;
  }

  outletState({ targetHeatingState, currentHeaterState }: AccessoryState) {
    return targetHeatingState === 0 || currentHeaterState === 0 ? 0 : 1;
  }

  updateOutletState(value: CharacteristicValue): Promise<CharacteristicValue> {
    const _value = this.config.invertOnOff === false ? value === 1 : value === 0;
    const state = _value ? "ON" : "OFF";

    const topic = this.topic(this.config.outlet) + "/set";
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
