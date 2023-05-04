require("dotenv").config();
const Web3 = require("web3");
const web3 = new Web3(process.env.ETHEREUM_NODE_URL);

const main = async () => {
  const nonce = await web3.eth.getTransactionCount(
    "0xcaFe1fC8Fe3a9Ea448a91Ac458A38Dbb331B08e6",
    "pending"
  );

  console.log(nonce + 1);
};

main();
