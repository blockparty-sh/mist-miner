import * as dotenv from "dotenv";
dotenv.config();
import BigNumber from "bignumber.js";
import { BITBOX as BITBOXSDK, ECPair } from "bitbox-sdk";
import * as crypto from "crypto";
import EventSource from "eventsource";
import fetch from "node-fetch";
import { BchdNetwork, LocalValidator,
         ScriptSigP2PK, ScriptSigP2PKH, ScriptSigP2SH,
         Slp, SlpAddressUtxoResult, TransactionHelpers,
         Utils} from "slpjs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const BITBOX = new BITBOXSDK();
const slp = new Slp(BITBOX);
const txnHelpers = new TransactionHelpers(slp);
export const fs = require("fs");
export const jsonFile = require("jsonfile");

import bchaddr from "bchaddrjs-slp";
const Bitcore = require("bitcoincashjs-lib-p2sh");

import { GrpcClient } from "grpc-bchrpc-node";
const client = new GrpcClient();

const minerWif: string = process.env.WIF!;
const minerPubKey = (new ECPair().fromWIF(minerWif)).getPublicKeyBuffer();
const minerBchAddress = Utils.toCashAddress((new ECPair().fromWIF(minerWif)).getAddress());
const minerSlpAddress = Utils.toSlpAddress(minerBchAddress);

const vaultHexTail = process.env.MINER_COVENANT_V1!;
const TOKEN_START_BLOCK = parseInt(process.env.TOKEN_START_BLOCK_V1 as string, 10);

export class TxCache {
 	public static txCache = new Map<string, Buffer>();
}

// setup a new local SLP validator
const validator = new LocalValidator(BITBOX, async (txids) => {
        let txnBuf;
        try {
            if (TxCache.txCache.has(txids[0])) {
                console.log(`Cache txid: ${txids[0]}`);
                return [ TxCache.txCache.get(txids[0])!.toString("hex") ];
            }
            console.log(`Downloading txid: ${txids[0]}`);
            const res = await client.getRawTransaction({ hash: txids[0], reversedHashOrder: true });
            txnBuf = Buffer.from(res.getTransaction_asU8());
            TxCache.txCache.set(txids[0], txnBuf);
	    let txCacheJson = mapToJson(TxCache.txCache);
 	    writeJsonToFile(txCacheJson);
        } catch (err) {
            throw Error(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`);
        }
        return [ txnBuf.toString("hex") ];
    },
);
const network = new BchdNetwork({BITBOX, client, validator});

// listen for new mints
let mintFound = false;
const sseMintQuery = {
    v: 3,
    "q": {
        find: {
            "slp.valid": true,
            "slp.detail.transactionType": "MINT",
            "slp.detail.tokenIdHex": process.env.TOKEN_ID_V1,
        },
    },
};
const sseb64 = Buffer.from(JSON.stringify(sseMintQuery)).toString("base64");
const sse = new EventSource(process.env.SLPSOCKET_URL + sseb64);
sse.onmessage = (e: any) => {
    try {
    	const data = JSON.parse(e.data);
    	if (data.type !== "mempool" && data.type !== "block" || data.data.length < 1) {
        	return;
    	}

    	mintFound = true;
    } catch (e) {
	//Fail silently
    }
};

export function doesTxsFileExist() {
 	return fs.existsSync("txs.json");
 }

 export function writeJsonToFile(jsonStr: string) {
 	jsonFile.writeFile('txs.json', JSON.parse(jsonStr));
 }

 export function readTxsToJsonString(callback: Function) {
 	fs.readFile('./txs.json', callback);
 }

 export function mapToJson(map: Map<string, Buffer>) {
   let jsonObject: any = {};  
   map.forEach((value, key) => {  
       jsonObject[key] = value  
   });
   let json = <JSON>jsonObject;
   return JSON.stringify(json);
 }

 export function jsonToMap(jsonStr: string) {
   let jsonObj = JSON.parse(jsonStr);
   let map = new Map<string, Buffer>();
   for (let key in jsonObj) {
      let val = jsonObj[key];
      var buf = Buffer.from(val["data"]);
      map.set(key, buf);
    }
   return map;
 }

const getRewardAmount = (block: number) => {
    const initReward = parseInt(process.env.TOKEN_INIT_REWARD_V1 as string, 10);
    const halveningInterval = parseInt(process.env.TOKEN_HALVING_INTERVAL_V1 as string, 10);
    return initReward / (Math.floor(block / halveningInterval) + 1);
};

export const generateV1 = async ({ lastBatonTxid, mintVaultAddressT0 }: { lastBatonTxid?: string, mintVaultAddressT0?: string }) => {

    // if lastBatonTxid is provided double check it is still unspent
    if (lastBatonTxid) {
        try {
            await client.getUnspentOutput({
                hash: lastBatonTxid, vout: 2,
                reversedHashOrder: true, includeMempool: true });
        } catch (_) {
            lastBatonTxid = undefined;
            mintVaultAddressT0 = undefined;
        }
    }

    // find lastest unspent baton transaction using slpdb
    let batonInputIndex = 0;
    let bchBlockHeight: number;
    if (!lastBatonTxid) {
        const batonQuery = {
            v: 3,
            "q": {
                db: ["g"],
                "aggregate": [
                    { $match: {
                        "tokenDetails.tokenIdHex": process.env.TOKEN_ID_V1 as string,
                        "graphTxn.outputs": {$elemMatch: {status: "BATON_UNSPENT"}}},
                    },
                    { $project: { graphTxn: 1, context: "SLPDB" }},
                    {
                        $lookup: {
                            from: "statuses",
                            localField: "context",
                            "foreignField": "context",
                            as: "status",
                        },
                    },
                    { $project: { "graphTxn": 1, "status.bchBlockHeight": 1} },
                ],
                limit: 10,
            },
        };

        const b64 = Buffer.from(JSON.stringify(batonQuery)).toString("base64");
        console.log(`Fetching current minting baton location...`);
        console.log(`SLPDB query: ${process.env.SLPDB_URL + b64}`);
        let res = undefined;
        let graphResjson = null;
        while (! res) {
            try {
                res = await fetch(process.env.SLPDB_URL + b64);
                graphResjson = await res.json();
                if (graphResjson.g.length !== 1) {
                    throw Error("Cannot find current contract tip!");
                }
            } catch (e) {
                console.log(e);
                res = undefined;
                await sleep(10000);
            }
        }

        const g = graphResjson.g[0];

        batonInputIndex = g.graphTxn.inputs.findIndex((i: any) => i.vout === 2);
        if (batonInputIndex !== 0 && !batonInputIndex) {
            throw Error("Cannot verify index of the previous baton input.");
        }
        lastBatonTxid = g.graphTxn.txid;
        mintVaultAddressT0 = g.graphTxn.outputs.find((o: any) => o.status === "BATON_UNSPENT").address;
        bchBlockHeight = g.status[0].bchBlockHeight;
    } else {
        bchBlockHeight = (await client.getBlockchainInfo()).getBestHeight();
    }

    console.log(`Current baton location: ${lastBatonTxid}:2`);
    console.log(`Blockchain height: ${bchBlockHeight}`);

    console.log(`Reward txo: ${lastBatonTxid}:2`);
    console.log(`Reward address: ${mintVaultAddressT0}`);

    // examine the transaction to determine the current state
    const rewardQuery = {
        v: 3,
        q: {
            db: ["u", "c"],
            find: {
                "tx.h": lastBatonTxid,
            },
            limit: 10,
        },
    };

    let txn: any;
    while (!txn) {
        const b64 = Buffer.from(JSON.stringify(rewardQuery)).toString("base64");
        console.log(`Fetching SLP previous minting baton scriptSig info...`);
        console.log(`SLPDB query: ${process.env.SLPDB_URL + b64}`);
        let res;
        try {
            res = await fetch(process.env.SLPDB_URL + b64);
        } catch (_) {
            await sleep(10000);
            continue;
        }
        let confResJson = null;
        try {
            confResJson = await res.json();
        } catch (e) {
            await sleep(10000);
            continue;
        }
        if (confResJson.c.length === 1) {
            txn = confResJson.c[0];
        } else if (confResJson.u.length === 1) {
            txn = confResJson.u[0];
        } else {
            console.log("Waiting for SLPDB to update...");
            await sleep(500);
        }

        let _bestTokenHeight: number;
        bchBlockHeight = (await client.getBlockchainInfo()).getBestHeight();
        try {
            const _stateT0: string = txn.in[batonInputIndex].h0;
            const buf = Buffer.from(_stateT0, "hex");
            _bestTokenHeight = buf.readInt32LE(0);
        } catch (_) {
            // unique case when mining for token height 1
            _bestTokenHeight = 0;
        }
        if (_bestTokenHeight >= (bchBlockHeight - TOKEN_START_BLOCK)) {
            txn = undefined;
            console.log("Token height is synchronized with block height, waiting for next block...");
            await sleep(10000);
        }
    }

    let bestTokenHeight: number;
    let stateT0: string = txn.in[batonInputIndex].h0;
    if (stateT0.length > 8 && txn.in[batonInputIndex].e.h === process.env.TOKEN_ID_V1) {
        bestTokenHeight = 0;
        stateT0 = "00000000";
    } else if (stateT0.length === 8) {
        const buf = Buffer.from(stateT0, "hex");
        bestTokenHeight = buf.readInt32LE(0);
    } else {
        throw Error("Unhandled exception.");
    }

    console.log(`Current Mist height: ${bestTokenHeight}`);

    // verify actual t0 address matches our computed address
    const encodeAsHex = (n: number) => {
        return BITBOX.Script.encode([BITBOX.Script.encodeNumber(n)]).toString("hex");
    };
    const initialMintAmount = encodeAsHex(parseInt(process.env.TOKEN_INIT_REWARD_V1 as string, 10));
    const difficultyLeadingZeroBytes = encodeAsHex(parseInt(process.env.MINER_DIFFICULTY_V1 as string, 10));
    const halvingInterval = encodeAsHex(parseInt(process.env.TOKEN_HALVING_INTERVAL_V1 as string, 10));
    const startingBlockHeight = encodeAsHex(parseInt(process.env.TOKEN_START_BLOCK_V1 as string, 10));
    const mintVaultHexT0 = `04${stateT0}20${process.env.TOKEN_ID_V1}${initialMintAmount}${difficultyLeadingZeroBytes}${halvingInterval}${startingBlockHeight}${vaultHexTail}`;

    const redeemScriptBufT0 = Buffer.from(mintVaultHexT0, "hex");
    const vaultHash160 = BITBOX.Crypto.hash160(redeemScriptBufT0);
    const vaultAddressT0 = Utils.slpAddressFromHash160(vaultHash160, "mainnet", "p2sh");
    console.log(`T0 redeemScript:\n${mintVaultHexT0}`);
    const scriptPubKeyHexT0 = "a914" + Buffer.from(bchaddr.decodeAddress(vaultAddressT0).hash).toString("hex") + "87";
    console.log(`T0 scriptPubKey:\n${scriptPubKeyHexT0}`);

    if (mintVaultAddressT0 !== vaultAddressT0) {
        throw Error("Mismatch contract address for t0, unknown error.");
    }

    // build t1 state
    const nextTokenHeight = bestTokenHeight + 1;
    const stateT1Buf = Buffer.alloc(4);
    stateT1Buf.writeInt32LE(nextTokenHeight, 0);
    const stateT1 = stateT1Buf.toString("hex");

    // construct the t1 contract
    const mintVaultHexT1 = `04${stateT1}20${process.env.TOKEN_ID_V1}${initialMintAmount}${difficultyLeadingZeroBytes}${halvingInterval}${startingBlockHeight}${vaultHexTail}`;
    const redeemScriptBufT1 = Buffer.from(mintVaultHexT1, "hex");
    const vaultHash160T1 = BITBOX.Crypto.hash160(redeemScriptBufT1);
    const vaultAddressT1 = Utils.slpAddressFromHash160(vaultHash160T1, "mainnet", "p2sh");
    console.log(`T1 redeemScript:\n${mintVaultHexT1}`);
    const scriptPubKeyHexT1 = "a914" + Buffer.from(bchaddr.decodeAddress(vaultAddressT1).hash).toString("hex") + "87";
    console.log(`T1 scriptPubKey:\n${scriptPubKeyHexT1}`);

    // get unspent UTXOs
    console.log(`Getting unspent txos for ${minerBchAddress}`);
    const unspent = await client.getAddressUtxos({ address: minerBchAddress, includeMempool: true });
    const txos = unspent.getOutputsList().map((o) => {
        return {
            cashAddress: minerBchAddress,
            satoshis: o.getValue(),
            txid: Buffer.from(o.getOutpoint()!.getHash_asU8().reverse()).toString("hex"),
            vout: o.getOutpoint()!.getIndex(),
            wif: process.env.WIF,
            scriptPubKey: Buffer.from(o.getPubkeyScript_asU8()).toString("hex"),
        } as SlpAddressUtxoResult;
    });

    console.log(`Completed fetching txos for ${minerBchAddress}`);

    // validate and categorize unspent TXOs
    // @ts-ignore
    console.log(`Validating Mist transactions...`);
    const utxos = await network.processUtxosForSlp(txos);
    console.log(`Finished validating Mist transactions...`);
    let txnInputs = utxos.nonSlpUtxos;

    if (txnInputs.length === 0) {
        throw Error("There are no non-SLP inputs available to pay for gas");
    }

    // add p2sh baton input with scriptSig
    const txo = {
        txid: lastBatonTxid,
        vout: 2,
        satoshis: 546,
    };
    // @ts-ignore
    const baton = await network.processUtxosForSlp([txo]);

    // select the inputs for transaction
    txnInputs = [ ...baton.slpBatonUtxos[process.env.TOKEN_ID_V1 as string], utxos.nonSlpUtxos[0] ];

    // construct the mint transaction preimage
    const extraFee = redeemScriptBufT0.length + 8 + 32 + 8 + 8 + 72 + 100;
    const rewardAmount = getRewardAmount(bestTokenHeight);

    // create a MINT Transaction
    let unsignedMintHex = txnHelpers.simpleTokenMint({
                                                tokenId: process.env.TOKEN_ID_V1!,
                                                mintAmount: new BigNumber(rewardAmount),
                                                inputUtxos: txnInputs,
                                                tokenReceiverAddress: minerSlpAddress,
                                                batonReceiverAddress: vaultAddressT1,
                                                changeReceiverAddress: minerSlpAddress,
                                                extraFee,
                                                disableBchChangeOutput: true,
                                                });

    // set nSequence to enable CLTV for all inputs, and set transaction Locktime
    unsignedMintHex = txnHelpers.enableInputsCLTV(unsignedMintHex);
    unsignedMintHex = txnHelpers.setTxnLocktime(unsignedMintHex, bchBlockHeight);

    // Build scriptSig
    const batonTxo = baton.slpBatonUtxos[process.env.TOKEN_ID_V1!][0];
    const batonTxoInputIndex = 0;
    const sigObj = txnHelpers.get_transaction_sig_p2sh(
                    unsignedMintHex,
                    minerWif,
                    batonTxoInputIndex,
                    batonTxo.satoshis,
                    redeemScriptBufT0,
                    redeemScriptBufT0,
                    );

    const tx = Bitcore.Transaction.fromHex(unsignedMintHex);
    const scriptPreImage: Buffer = tx.sigHashPreimageBuf(0, redeemScriptBufT0, 546, 0x41);

    // mine for the solution
    const difficulty = parseInt(process.env.MINER_DIFFICULTY_V1 as string, 10);
    const prehash = Buffer.concat([scriptPreImage, crypto.randomBytes(4)]);
    let solhash = BITBOX.Crypto.hash256(prehash);
    let count = 0;

    console.log(`Mining height: ${bestTokenHeight + 1} (baton txid: ${lastBatonTxid})`);
    console.log("Please wait, mining for Mist...");

    while (!solhash.slice(0, difficulty).toString("hex").split("").every((s) => s === "0")) {
        prehash[0 + scriptPreImage.length] = Math.floor(Math.random() * 255);
        prehash[1 + scriptPreImage.length] = Math.floor(Math.random() * 255);
        prehash[2 + scriptPreImage.length] = Math.floor(Math.random() * 255);
        prehash[3 + scriptPreImage.length] = Math.floor(Math.random() * 255);
        solhash = BITBOX.Crypto.hash256(prehash);

        // sse early exit so we can try again
        if (mintFound) {
            console.log(`Token reward has been found, solution forfeited for ${lastBatonTxid} (on sse).`);
            mintFound = false;
            return {};
        }

        // since sse doesn't always work, we check manually every so often
        if (count === 0 || count === 100000) {
            try {
                await client.getUnspentOutput({ hash: lastBatonTxid!, vout: 2, reversedHashOrder: true, includeMempool: true });
            } catch (_) {
                console.log(`Token reward has been found, solution forfeited for ${lastBatonTxid} (on interval check).`);
                return {};
            }
            count = 0;
        }
        count++;
    }

    // after mining, check if its already spent again
    try {
        await client.getUnspentOutput({ hash: lastBatonTxid!, vout: 2, reversedHashOrder: true, includeMempool: true });
    } catch (_) {
        console.log(`Token reward has been found, solution forfeited for ${lastBatonTxid} (post-mine forfeit).`);
        return {};
    }

    const mintAmountLE = Buffer.alloc(4);
    mintAmountLE.writeUInt32LE(rewardAmount, 0);

    const scriptSigsP2sh = {
        index: batonTxoInputIndex,
        lockingScriptBuf: redeemScriptBufT0,
        unlockingScriptBufArray: [
            stateT1Buf,
            prehash.slice(scriptPreImage.length),
            // Buffer.from("2202000000000000", "hex"),
            mintAmountLE,
            sigObj.signatureBuf,
            minerPubKey,
            scriptPreImage,
            Buffer.from(process.env.MINER_UTF8 as string, "utf8"),
        ],
    } as ScriptSigP2SH;

    // Build p2pkh scriptSigs
    txnInputs[1].wif = process.env.WIF as string;
    const scriptSigsP2pkh = txnHelpers.get_transaction_sig_p2pkh(
                                                unsignedMintHex,
                                                minerWif,
                                                1, txnInputs[1].satoshis,
                                                ) as ScriptSigP2PKH;

    const scriptSigs = [ scriptSigsP2sh, scriptSigsP2pkh ] as Array<ScriptSigP2PK|ScriptSigP2PKH|ScriptSigP2SH>;
    const signedTxn = txnHelpers.addScriptSigs(unsignedMintHex, scriptSigs);
    console.log(`scriptPubKeyHex T0: ${scriptPubKeyHexT0}`);
    console.log(`redeem Script Buf T0: ${redeemScriptBufT0.toString("hex")}`);
    console.log(`scriptPubKeyHex T1: ${scriptPubKeyHexT1}`);
    console.log(`redeem Script Buf T1: ${redeemScriptBufT1.toString("hex")}`);
    console.log(signedTxn);

    // submit our signed solution
    try {
        const txres = await client.submitTransaction({txnHex: signedTxn});
        lastBatonTxid = Buffer.from(txres.getHash_asU8().reverse()).toString("hex");
        mintVaultAddressT0 = vaultAddressT1;
        console.log(`Submitted solution in txid: ${lastBatonTxid}`);
        return { lastBatonTxid, mintVaultAddressT0 };
    } catch (_) {}
    console.log(`Token reward has been found, solution forfeited for ${lastBatonTxid} (failed submit txn).`);
    return {};
};
