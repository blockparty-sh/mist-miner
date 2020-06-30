import * as dotenv from "dotenv";
dotenv.config();

import { generateV1 } from "./generateV1";
import { jsonToMap } from "./generateV1";
import { mapToJson } from "./generateV1";
import { writeJsonToFile } from "./generateV1";
import { readTxsToJsonString } from "./generateV1";
import { doesTxsFileExist } from "./generateV1";
import { TxCache } from "./generateV1";

if(doesTxsFileExist()) {
    console.log(`Loading cached txs...`);
    try {
        TxCache.txCache = jsonToMap(readTxsToJsonString());
    } catch (e) {
        console.log(e);
    }
}

const run = async () => {
    let state: any = {};
    while (true) {
        try {
            state = await generateV1(state);
        } catch(e) {
            console.log(e);
        }
    }
};


run();
