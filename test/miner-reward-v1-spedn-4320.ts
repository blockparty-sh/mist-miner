import * as dotenv from "dotenv";
dotenv.config();

import assert from "assert";
import BigNumber from "bignumber.js";
import { BITBOX, ECPair } from "bitbox-sdk";
import * as crypto from "crypto";
import { step } from "mocha-steps";
import { LocalValidator, Slp,
            SlpAddressUtxoResult, TransactionHelpers,
            Utils } from "slpjs";

const bchaddr = require("bchaddrjs-slp");
const Bitcore = require("bitcoincashjs-lib-p2sh");
const rpcClient = require("bitcoin-rpc-promise-retry");

// connect rpc client to regtest network (see "regtest" directory)
const connectionStringNodeMiner = "http://bitcoin:password@0.0.0.0:18443";
const rpcNodeMiner = new rpcClient(connectionStringNodeMiner, { maxRetries: 0 });

const bitbox = new BITBOX();
const slp = new Slp(bitbox);
const txnHelpers = new TransactionHelpers(slp);

let minerP2pkhAddrRegtest: string;
let minerP2pkhAddrSlptest: string;
let minerP2shVaultAddrSlptestT0: string;
let minerP2shVaultAddrSlptestT1: string;
let minerP2shVaultAddrSlptestT2: string;
let minerPubKey: Buffer;
let minerWif: string;
let lastMintTxid: string;
let scriptPubKeyHexT0: string;
let redeemScriptBufT0: Buffer;
let scriptPubKeyHexT1: string;
let redeemScriptBufT1: Buffer;
let scriptPubKeyHexT2: string;
let redeemScriptBufT2: Buffer;
let txnInputs: SlpAddressUtxoResult[];

const getRewardAmount = (block: number) => {
    const initReward = parseInt(process.env.TOKEN_INIT_REWARD_V1 as string, 10);
    const halveningInterval = parseInt(process.env.TOKEN_HALVING_INTERVAL_V1 as string, 10);
    return initReward / (Math.floor(block / halveningInterval) + 1);
};

const difficulty = 1;

// this is token state height
const stateT0TokenHeight = 4318;  // .env contract has 0 hard-coded
const stateT1TokenHeight = stateT0TokenHeight + 1;
const stateT2TokenHeight = stateT1TokenHeight + 1;

// this is blockchain height -- commented out in several places so we can test expected rewards reduction
//let blockT0: number;
//let blockT1: number;
const expectedT1Reward = getRewardAmount(stateT1TokenHeight);
if (expectedT1Reward !== 400000000) {
    throw Error(`Unexpected reward value for token height ${expectedT1Reward}`);
}
//let blockT2: number;
const expectedT2Reward = getRewardAmount(stateT2TokenHeight);
if (expectedT2Reward !== 200000000) {
    throw Error(`Unexpected reward value for token height ${expectedT2Reward}`);
}
let prehash: Buffer;

// setup a new local SLP validator
const validator = new LocalValidator(bitbox, async (txids) => {
    let txn;
    try {
        txn = ( await rpcNodeMiner.getRawTransaction(txids[0]) as string);
    } catch (err) {
        throw Error(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`);
    }
    return [ txn ];
}, console);

describe("Mint", () => {
    step("[SETUP] Initial setup for all tests", async () => {

        const currentBlockHeight = await rpcNodeMiner.getblockcount();
        const targetBlockHeight = stateT0TokenHeight;
        if (currentBlockHeight < targetBlockHeight) {
            for (let i = currentBlockHeight; i < targetBlockHeight; i++) {
                await rpcNodeMiner.generate(1);
                console.log(`Generated block:${i}`);
            }
        }
        await rpcNodeMiner.generate(1);

        // make sure we have coins to use in tests
        let balance = await rpcNodeMiner.getBalance();
        while (balance < 1) {
            await rpcNodeMiner.generate(1);
            balance = await rpcNodeMiner.getBalance();
        }

        // put all the funds on the receiver's address
        //
        // console.log(receiverRegtest);
        minerP2pkhAddrRegtest = await rpcNodeMiner.getNewAddress("0");
        await rpcNodeMiner.sendToAddress(minerP2pkhAddrRegtest, 1, "", "", true);
        minerP2pkhAddrSlptest = Utils.toSlpAddress(minerP2pkhAddrRegtest);
    });

    step("[SETUP] Get public/private key for issuer and the token receiver address.", async () => {
        minerWif = await rpcNodeMiner.dumpPrivKey(minerP2pkhAddrRegtest);
        minerPubKey = (new ECPair().fromWIF(minerWif)).getPublicKeyBuffer();
    });

    step("[SETUP] GENESIS: setup for the txn tests", async () => {
        let unspent = await rpcNodeMiner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === minerP2pkhAddrRegtest);
        if (unspent.length === 0) { throw Error("No unspent outputs."); }
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount * 10 ** 8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNodeMiner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        const utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
        txnInputs = utxos.nonSlpUtxos;

        assert.equal(txnInputs.length > 0, true);

        // get current block and set block for state T0, T1, and T2
        // blockT0 = 0; //(await rpcNodeMiner.getblockcount()) - 1;
        // blockT1 = blockT0 + 1;
        // blockT2 = blockT1 + 1;
    });

    let tokenId: string;

    step("[SETUP] Create a new token genesis", async () => {
        const genesisHex = txnHelpers.simpleTokenGenesis({
                                        tokenName: "unit-test-1",
                                        tokenTicker: "ut1",
                                        tokenAmount: new BigNumber(0),
                                        documentUri: null, documentHash: null,
                                        decimals: 6,
                                        tokenReceiverAddress: minerP2pkhAddrSlptest,
                                        batonReceiverAddress: minerP2pkhAddrSlptest,
                                        bchChangeReceiverAddress: minerP2pkhAddrSlptest,
                                        inputUtxos: txnInputs
                                    });

        try {
            tokenId = await rpcNodeMiner.sendRawTransaction(genesisHex, true);
        } catch (_) {
            tokenId = await rpcNodeMiner.sendRawTransaction(genesisHex, 0);
        }
    });

    step("[SETUP] Setup the mint vault contract addresses", async () => {

        const buf0 = Buffer.alloc(4);
        buf0.writeInt32LE(stateT0TokenHeight, 0);
        const buf1 = Buffer.alloc(4);
        buf1.writeInt32LE(stateT1TokenHeight, 0);
        const buf2 = Buffer.alloc(4);
        buf2.writeInt32LE(stateT2TokenHeight, 0);

        const contractStateT0 = buf0.toString("hex");
        const contractStateT1 = buf1.toString("hex");
        const contractStateT2 = buf2.toString("hex");

        const encodeAsHex = (n: number) => {
            return bitbox.Script.encode([bitbox.Script.encodeNumber(n)]).toString("hex");
        };
        const initialMintAmount = encodeAsHex(parseInt(process.env.TOKEN_INIT_REWARD_V1 as string, 10));
        const difficultyLeadingZeroBytes = encodeAsHex(difficulty);  // reduce the difficulty to allow faster mining in unit testing
        const halvingInterval = encodeAsHex(parseInt(process.env.TOKEN_HALVING_INTERVAL_V1 as string, 10));
        const startingBlockHeight = encodeAsHex(0); // use 0 here so we can bypass OP_CLTV issues
        const vaultHexTail = `20${tokenId}${initialMintAmount}${difficultyLeadingZeroBytes}${halvingInterval}${startingBlockHeight}${process.env.MINER_COVENANT_V1 as string}`;

        const vaultHexT0 = `04${contractStateT0}${vaultHexTail}`;

        redeemScriptBufT0 = Buffer.from(vaultHexT0, "hex");
        const vaultHash160 = bitbox.Crypto.hash160(redeemScriptBufT0);
        const vaultAddressT0 = Utils.slpAddressFromHash160(vaultHash160, "testnet", "p2sh");
        console.log(`redeemScript:\n${vaultHexT0}`);
        scriptPubKeyHexT0 = "a914" + Buffer.from(bchaddr.decodeAddress(vaultAddressT0).hash).toString("hex") + "87";
        console.log(`scriptPubKey:\n${scriptPubKeyHexT0}`);
        minerP2shVaultAddrSlptestT0 = Utils.toSlpAddress(vaultAddressT0);

        const vaultHexT1 = `04${contractStateT1}${vaultHexTail}`;
        redeemScriptBufT1 = Buffer.from(vaultHexT1, "hex");
        const vaultHash160T1 = bitbox.Crypto.hash160(redeemScriptBufT1);
        const vaultAddressT1 = Utils.slpAddressFromHash160(vaultHash160T1, "testnet", "p2sh");
        console.log(`redeemScript:\n${vaultHexT1}`);
        scriptPubKeyHexT1 = "a914" + Buffer.from(bchaddr.decodeAddress(vaultAddressT1).hash).toString("hex") + "87";
        console.log(`scriptPubKey:\n${scriptPubKeyHexT1}`);
        minerP2shVaultAddrSlptestT1 = Utils.toSlpAddress(vaultAddressT1);

        const vaultHexT2 = `04${contractStateT2}${vaultHexTail}`;
        redeemScriptBufT2 = Buffer.from(vaultHexT2, "hex");
        const vaultHash160T2 = bitbox.Crypto.hash160(redeemScriptBufT2);
        const vaultAddressT2 = Utils.slpAddressFromHash160(vaultHash160T2, "testnet", "p2sh");
        console.log(`redeemScript:\n${vaultHexT2}`);
        scriptPubKeyHexT2 = "a914" + Buffer.from(bchaddr.decodeAddress(vaultAddressT2).hash).toString("hex") + "87";
        console.log(`scriptPubKey:\n${scriptPubKeyHexT1}`);
        minerP2shVaultAddrSlptestT2 = Utils.toSlpAddress(vaultAddressT2);
    });

    step("[SETUP] Send the p2pkh mint baton to the mint vault contract address", async () => {
        // get current address UTXOs
        let unspent = await rpcNodeMiner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === minerP2pkhAddrRegtest);
        if (unspent.length === 0) { throw Error("No unspent outputs."); }
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount * 10 ** 8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNodeMiner.dumpPrivKey(txo.address)));

        // process raw UTXOs
        const utxos = await slp.processUtxosForSlpAbstract(unspent, validator);

        // select the inputs for transaction
        txnInputs = [ ...utxos.nonSlpUtxos, ...utxos.slpBatonUtxos[tokenId] ];

        assert.equal(txnInputs.length > 1, true);

        // create a MINT Transaction to transfer the baton to the vault 0 tokens minted
        const mintHex = txnHelpers.simpleTokenMint({tokenId,
                                                    mintAmount: new BigNumber(0),
                                                    inputUtxos: txnInputs,
                                                    tokenReceiverAddress: minerP2pkhAddrSlptest,
                                                    batonReceiverAddress: minerP2shVaultAddrSlptestT0,
                                                    changeReceiverAddress: minerP2pkhAddrSlptest,
                                                    });

        try {
            lastMintTxid = await rpcNodeMiner.sendRawTransaction(mintHex, true);
        } catch (_) {
            lastMintTxid = await rpcNodeMiner.sendRawTransaction(mintHex, 0);
        }

        console.log(lastMintTxid);
    });

    step("[MINT VAULT SPEND] Mine / Mint new tokens from the contract address T0, send to contract address T1", async () => {

        // generate block to make satisfy CTLV
        await rpcNodeMiner.generate(1);

        // get current address UTXOs
        let unspent = await rpcNodeMiner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === minerP2pkhAddrRegtest);
        if (unspent.length === 0) { throw Error("No unspent outputs."); }
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount * 10 ** 8);

        // process raw UTXOs
        const utxos = await slp.processUtxosForSlpAbstract(unspent, validator);

        // add p2sh baton input with scriptSig
        let txo = await rpcNodeMiner.gettxout(lastMintTxid, 2, true);
        txo.txid = lastMintTxid;
        txo.vout = 2;
        let baton = await slp.processUtxosForSlpAbstract([txo], validator);

        assert.equal(baton.slpBatonUtxos[tokenId].length, 1);

        // select the inputs for transaction
        txnInputs = [ ...baton.slpBatonUtxos[tokenId], ...utxos.nonSlpUtxos ];

        assert.equal(txnInputs.length > 1, true);

        // Estimate the additional fee for our larger p2sh scriptSig
        const extraFee = redeemScriptBufT0.length + 8 + 32 + 8 + 8 + 72 + 100;
        const rewardAmount = getRewardAmount(stateT1TokenHeight);

        // create a MINT Transaction
        let unsignedMintHex = txnHelpers.simpleTokenMint({
                                                tokenId,
                                                mintAmount: new BigNumber(rewardAmount),
                                                inputUtxos: txnInputs,
                                                tokenReceiverAddress: minerP2pkhAddrSlptest,
                                                batonReceiverAddress: minerP2shVaultAddrSlptestT1,
                                                changeReceiverAddress: minerP2pkhAddrSlptest,
                                                extraFee,
                                                disableBchChangeOutput: true,
                                                });

        // set nSequence to enable CLTV for all inputs, and set transaction Locktime
        unsignedMintHex = txnHelpers.enableInputsCLTV(unsignedMintHex);
        unsignedMintHex = txnHelpers.setTxnLocktime(unsignedMintHex, stateT1TokenHeight); //blockT1);

        // Build p2sh scriptSigs
        const scriptSigsP2sh = baton.slpBatonUtxos[tokenId].map((txo, i) => {
            const sigObj = txnHelpers.get_transaction_sig_p2sh(
                                                    unsignedMintHex,
                                                    minerWif,
                                                    i,
                                                    txo.satoshis,
                                                    redeemScriptBufT0,
                                                    redeemScriptBufT0,
                                                    );

            const txn = Bitcore.Transaction.fromHex(unsignedMintHex);
            const preimageChunks: Buffer[] = txn.sigHashPreimageBufChunks(i, redeemScriptBufT0, 546, 0x41);
            const preimage = Buffer.concat([...preimageChunks]);

            const stateT1HeightBuf = Buffer.alloc(4);
            stateT1HeightBuf.writeInt32LE(stateT1TokenHeight, 0);
            const state_t1 = Buffer.concat([stateT1HeightBuf]);

            if (difficulty > 0) {
                // mine for the solution
                prehash = Buffer.concat([preimage, crypto.randomBytes(4)]);
                let solhash = bitbox.Crypto.hash256(prehash);
                let count = 0;
                console.log("Mining for a solution...");
                while (!solhash.slice(0, difficulty).toString("hex").split("").every(s => s === "0")) {
                    prehash[0 + preimage.length] = Math.floor(Math.random() * 255);
                    prehash[1 + preimage.length] = Math.floor(Math.random() * 255);
                    prehash[2 + preimage.length] = Math.floor(Math.random() * 255);
                    prehash[3 + preimage.length] = Math.floor(Math.random() * 255);
                    solhash = bitbox.Crypto.hash256(prehash);
                    //console.log(`generated: ${solhash.toString("hex")}`);  leads memory
                    count++;
                }
            }

            const mintAmountLE = Buffer.alloc(4);
            mintAmountLE.writeUInt32LE(rewardAmount, 0);

            return {
                index: i,
                lockingScriptBuf: redeemScriptBufT0,
                unlockingScriptBufArray: [
                    state_t1,
                    prehash.slice(preimage.length),
                    // Buffer.from("2202000000000000", "hex"),
                    mintAmountLE,
                    sigObj.signatureBuf,
                    minerPubKey,
                    preimage,
                    Buffer.from(process.env.MINER_UTF8 as string, "utf8"),
                ],
            };
        });

        // Build p2pkh scriptSigs
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNodeMiner.dumpPrivKey(txo.address)));
        const scriptSigsP2pkh = utxos.nonSlpUtxos.map((txo, i) => {
            return txnHelpers.get_transaction_sig_p2pkh(
                                                    unsignedMintHex,
                                                    minerWif,
                                                    i+1, txo.satoshis,
                                                    );
        });

        const scriptSigs = [ ...scriptSigsP2sh, ...scriptSigsP2pkh ];
        const signedTxn = txnHelpers.addScriptSigs(unsignedMintHex, scriptSigs);
        console.log(`scriptPubKeyHex T0: ${scriptPubKeyHexT0}`);
        console.log(`redeem script hex T0: ${redeemScriptBufT0.toString("hex")}`);
        console.log(`scriptPubKeyHex T1: ${scriptPubKeyHexT1}`);
        console.log(`redeem script hex T1: ${redeemScriptBufT1.toString("hex")}`);
        console.log(signedTxn);
        try {
            lastMintTxid = await rpcNodeMiner.sendRawTransaction(signedTxn, true);
        } catch (error) {
            lastMintTxid = await rpcNodeMiner.sendRawTransaction(signedTxn, 0);
        }

        // make sure we still have 1 valid baton after spending the contract
        txo = await rpcNodeMiner.gettxout(lastMintTxid, 2, true);
        txo.txid = lastMintTxid;
        txo.vout = 2;
        baton = await slp.processUtxosForSlpAbstract([txo], validator);
        assert.equal(baton.slpBatonUtxos[tokenId].length, 1);

        // make sure we mined X tokens
        txo = await rpcNodeMiner.gettxout(lastMintTxid, 1, true);
        txo.txid = lastMintTxid;
        txo.vout = 1;
        const processed = await slp.processUtxosForSlpAbstract([txo], validator);
        assert.equal(processed.slpTokenUtxos[tokenId].length, 1);
        assert.equal(processed.slpTokenUtxos[tokenId][0].slpUtxoJudgementAmount.isEqualTo((new BigNumber(expectedT1Reward))), true);
        assert.equal(processed.slpTokenUtxos[tokenId][0].slpUtxoJudgementAmount.isEqualTo((new BigNumber(400000000))), true);
    });

    step("[MINT VAULT SPEND] Mine / Mint new tokens from the contract address T1, send to contract address T2", async () => {

        // generate block to make satisfy CTLV
        await rpcNodeMiner.generate(1);

        // Send more bch to the minerP2pkhAddrRegtest since the previous txn burns a large input (should be fixed)
        await rpcNodeMiner.sendToAddress(minerP2pkhAddrRegtest, 1, "", "", true);

        // get current address UTXOs
        let unspent = await rpcNodeMiner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === minerP2pkhAddrRegtest);
        if (unspent.length === 0) { throw Error("No unspent outputs."); }
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount * 10 ** 8);

        // process raw UTXOs
        const utxos = await slp.processUtxosForSlpAbstract(unspent, validator);

        // add p2sh baton input with scriptSig
        let txo = await rpcNodeMiner.gettxout(lastMintTxid, 2, true);
        txo.txid = lastMintTxid;
        txo.vout = 2;
        let baton = await slp.processUtxosForSlpAbstract([txo], validator);

        assert.equal(baton.slpBatonUtxos[tokenId].length, 1);

        // select the inputs for transaction
        txnInputs = [ ...baton.slpBatonUtxos[tokenId], ...utxos.nonSlpUtxos ];

        assert.equal(txnInputs.length > 1, true);

        // Estimate the additional fee for our larger p2sh scriptSig
        const extraFee = redeemScriptBufT0.length + 8 + 32 + 8 + 8 + 72 + 100;
        const rewardAmount = getRewardAmount(stateT2TokenHeight);

        // create a MINT Transaction
        let unsignedMintHex = txnHelpers.simpleTokenMint({
                                                tokenId,
                                                mintAmount: new BigNumber(rewardAmount),
                                                inputUtxos: txnInputs,
                                                tokenReceiverAddress: minerP2pkhAddrSlptest,
                                                batonReceiverAddress: minerP2shVaultAddrSlptestT2,
                                                changeReceiverAddress: minerP2pkhAddrSlptest,
                                                extraFee,
                                                disableBchChangeOutput: true,
                                                });

        // set nSequence to enable CLTV for all inputs, and set transaction Locktime
        unsignedMintHex = txnHelpers.enableInputsCLTV(unsignedMintHex);
        unsignedMintHex = txnHelpers.setTxnLocktime(unsignedMintHex, stateT2TokenHeight); //blockT2);

        // Build p2sh scriptSig
        const scriptSigsP2sh = baton.slpBatonUtxos[tokenId].map((txo, i) => {
            const sigObj = txnHelpers.get_transaction_sig_p2sh(
                                                    unsignedMintHex,
                                                    minerWif,
                                                    i,
                                                    txo.satoshis,
                                                    redeemScriptBufT1,
                                                    redeemScriptBufT1,
                                                    );

            const txn = Bitcore.Transaction.fromHex(unsignedMintHex);
            const preimage: Buffer = txn.sigHashPreimageBuf(i, redeemScriptBufT1, 546, 0x41);

            const diffBuf = Buffer.alloc(1);
            diffBuf.writeInt8(difficulty, 0);
            const stateT2HeightBuf = Buffer.alloc(4);
            stateT2HeightBuf.writeInt32LE(stateT2TokenHeight, 0);
            const state_t2 = Buffer.concat([stateT2HeightBuf]); //, diffBuf]);

            if (difficulty > 0) {
                // mine for the solution
                prehash = Buffer.concat([preimage, crypto.randomBytes(4)]);
                let solhash = bitbox.Crypto.hash256(prehash);
                let count = 0;
                console.log("Mining for a solution...");
                while (!solhash.slice(0, difficulty).toString("hex").split("").every(s => s === "0")) {
                    prehash[0 + preimage.length] = Math.floor(Math.random() * 255);
                    prehash[1 + preimage.length] = Math.floor(Math.random() * 255);
                    prehash[2 + preimage.length] = Math.floor(Math.random() * 255);
                    prehash[3 + preimage.length] = Math.floor(Math.random() * 255);
                    solhash = bitbox.Crypto.hash256(prehash);
                    //console.log(`generated: ${solhash.toString("hex")}`);  leads memory
                    count++;
                }
            }

            const mintAmountLE = Buffer.alloc(4);
            mintAmountLE.writeUInt32LE(rewardAmount, 0);

            return {
                index: i,
                lockingScriptBuf: redeemScriptBufT1,
                unlockingScriptBufArray: [
                    state_t2,
                    prehash.slice(preimage.length),
                    // Buffer.from("2202000000000000", "hex"),
                    mintAmountLE,
                    sigObj.signatureBuf,
                    minerPubKey,
                    preimage,
                    Buffer.from(process.env.MINER_UTF8 as string, "utf8"),
                ],
            };
        });

        // Build p2pkh scriptSigs
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNodeMiner.dumpPrivKey(txo.address)));
        const scriptSigsP2pkh = utxos.nonSlpUtxos.map((txo, i) => {
            return txnHelpers.get_transaction_sig_p2pkh(
                                                    unsignedMintHex,
                                                    minerWif,
                                                    i + 1,
                                                    txo.satoshis,
                                                    );
        });

        const scriptSigs = [ ...scriptSigsP2sh, ...scriptSigsP2pkh ];
        const signedTxn = txnHelpers.addScriptSigs(unsignedMintHex, scriptSigs);
        console.log(`scriptPubKeyHex T1: ${scriptPubKeyHexT1}`);
        console.log(`redeem script hex T1: ${redeemScriptBufT1.toString("hex")}`);
        console.log(`scriptPubKeyHex T2: ${scriptPubKeyHexT2}`);
        console.log(`redeem script hex T2: ${redeemScriptBufT2.toString("hex")}`);
        console.log(signedTxn);
        try {
            lastMintTxid = await rpcNodeMiner.sendRawTransaction(signedTxn, true);
        } catch (error) {
            lastMintTxid = await rpcNodeMiner.sendRawTransaction(signedTxn, 0);
        }

        // make sure we still have 1 valid baton after spending the contract
        txo = await rpcNodeMiner.gettxout(lastMintTxid, 2, true);
        txo.txid = lastMintTxid;
        txo.vout = 2;
        baton = await slp.processUtxosForSlpAbstract([txo], validator);
        assert.equal(baton.slpBatonUtxos[tokenId].length, 1);

        // make sure we mined X tokens
        txo = await rpcNodeMiner.gettxout(lastMintTxid, 1, true);
        txo.txid = lastMintTxid;
        txo.vout = 1;
        const processed = await slp.processUtxosForSlpAbstract([txo], validator);
        assert.equal(processed.slpTokenUtxos[tokenId].length, 1);
        assert.equal(processed.slpTokenUtxos[tokenId][0].slpUtxoJudgementAmount.isEqualTo((new BigNumber(expectedT2Reward))), true);
        assert.equal(processed.slpTokenUtxos[tokenId][0].slpUtxoJudgementAmount.isEqualTo((new BigNumber(200000000))), true);
    });
});
