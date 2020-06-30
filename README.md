# Mist

*A mineable SLP token using a proof-of-work covenant contract*

[mistcoin.org](https://mistcoin.org)

## Introduction

This is a continuation of the 0.0.2 Miner that is on mistcoin.org


## Setup Instructions (Mac)

### 1. Open a terminal

click Launchpad icon in the Dock

type Terminal in the search field

then click Terminal

### 2. Install homebrew

Paste this into the terminal:

`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install.sh)"`

### 3. Install nodejs with homebrew

brew install node

### 4. Download mist-miner

`git clone https://github.com/blockparty-sh/mist-miner.git`

### 5. Copy example.env file

Go into the downloaded directory

`cd mist-miner`

Paste this into the terminal:

`cp example.env .env`

### 6. Install the dependencies for the project

`npm install`


### 7. Build fastminer

Ensure you have recent C++ compiler and `make`

`cd fastmine`

`make`

`cd ..`

### 8. Set up Electron Cash SLP Edition Mining Wallet

Open Electron Cash SLP Edition and create a new normal wallet

Inside the wallet Click on the "Addresses" pane

Right click on the index 0 address and click on "Private key"

Copy the Private key (Command+c) (⌘ key) 

Open the `.env` file by typing this into the terminal:

`open -a TextEdit .env`

On the third line you will see `WIF=""`

Paste your private key inside the quotes so that it looks like this: `WIF="Kansadjasd767263764"`

Save the file and close the editor.

### 9. Fund the Mining Wallet

Inside Electron Cash SLP again, right click the address at index 0 again and click on "Copy address"

Open a different wallet which has BCH available using Electron Cash SLP

Go to the "Send" pane

Inside the "Pay to" field, paste the address and then add the amount like this:

`simpleledger:qpasd8a7sdasdjkasd7as7dd,0.00001870`

Now copy everything in the "Pay to" field and paste it many more times, I did ~100

It should look like this:

```
simpleledger:qpasd8a7sdasdjkasd7as7dd,0.00001870
simpleledger:qpasd8a7sdasdjkasd7as7dd,0.00001870
simpleledger:qpasd8a7sdasdjkasd7as7dd,0.00001870
simpleledger:qpasd8a7sdasdjkasd7as7dd,0.00001870
simpleledger:qpasd8a7sdasdjkasd7as7dd,0.00001870
simpleledger:qpasd8a7sdasdjkasd7as7dd,0.00001870
simpleledger:qpasd8a7sdasdjkasd7as7dd,0.00001870
```

In the "BCH Amount" field put some small amount of BCH (like 0.0001), this wont be used but was needed for me to make it work

Click "Preview" to ensure that there are no mistakes and that the format was correct.

Then click "Sign" and then "Broadcast"

You can now close this wallet.

### 10. Start Mining

Inside the terminal type:

`npm start`

This will build the application and begin mining Mist!

### 11. Updating the Miner

If there are updates in the future you can update by running:

`git pull origin master`

## Block Notifier

### ZMQ

You need a full node for this to connect to, with hashblock on port 28332.

IE your `bitcoin.conf` should have this:

`zmqpubhashblock=tcp://127.0.0.1:28332`

Install zeromq package:

`npm i zeromq`

In `.env` set `BLOCK_NOTIFIER` to `zmq`
