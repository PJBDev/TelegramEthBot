require("dotenv").config();
const Web3 = require("web3");
const web3 = new Web3(process.env.ETHEREUM_NODE_URL);

const main = async () => {
  const nonce = await web3.eth.getTransactionCount(
    "0x8226bcef50b3c76a9Eb7ebA0C09ebbb2362e5db7",
    "latest"
  );

  console.log(nonce + 1);
};

main();
