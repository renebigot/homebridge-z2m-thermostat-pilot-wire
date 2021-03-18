import { API } from "homebridge";

import { ACCESSORY_NAME } from "./settings";
import Thermostat from "./thermostat";

export = (api: API) => {
  api.registerAccessory(ACCESSORY_NAME, Thermostat);
};
