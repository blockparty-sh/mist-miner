## Script Testing on Regtest network

To get started with regtest network tests you need to startup a bitcoin full node using the following additions/modifications to bitcoin.conf settings:

```
regtest=1
rpcport=18443
rpcuser=bitcoin
rpcpassword=password
```

Run the unit tests:

```
$ npm test
```
