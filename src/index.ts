import { API } from "homebridge";

import { PLATFORM_NAME } from "./settings";
import Thermostat from "./thermostat";

export = (api: API) => {
  api.registerAccessory(PLATFORM_NAME, Thermostat);
};
