import * as dotenv from "dotenv";
dotenv.config();

import { generateV1 } from "./generateV1";

const run = async () => {
    let state: any = {};
    while (true) {
        state = await generateV1(state);
    }
};

run();
