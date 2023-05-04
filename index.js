require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Tx = require("ethereumjs-tx").Transaction;
const Web3 = require("web3");
const axios = require("axios");

const privateKey = Buffer.from(process.env.CONTRACT_OWNER_PRIVATE_KEY, "hex");
const token = process.env.TELEGRAM_BOT_TOKEN;
const web3 = new Web3(process.env.ETHEREUM_NODE_URL);
const apiKey = process.env.ETHERSCAN_API_KEY;
const bot = new TelegramBot(token, { polling: true });

// Get the ABI for the contract
async function getAbi(contractAddress) {
  try {
    const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${contractAddress}&apikey=${apiKey}`;
    const response = await axios.get(url);

    return JSON.parse(response.data.result);
  } catch (err) {
    console.error(
      `Error retrieving ABI for contract at address ${contractAddress}: ${err}`
    );
    return null;
  }
}

// Get the current gas price
async function getGasPrice() {
  try {
    const url = `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${apiKey}`;
    const response = await axios.get(url);
    const gasPrice = response.data.result.ProposeGasPrice;
    const gasPriceInWei = web3.utils.toWei(gasPrice.toString(), "gwei");
    return gasPriceInWei;
  } catch (err) {
    console.error(`Error retrieving gas price: ${err}`);
    return null;
  }
}

// Get the gas limit for the transaction
async function getGasLimit(from, to) {
  try {
    return await web3.eth.estimateGas({
      from,
      to,
      value: web3.utils.toWei("0.01", "ether"),
    });
  } catch (err) {
    console.error(`Error retrieving gas limit: ${err}`);
    return null;
  }
}

// Create a state machine to track the user's progress
const stateMachine = {};

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // reset the state machine
  if (msg.text === "/reset") {
    delete stateMachine[chatId];
    return bot.sendMessage(chatId, "State machine reset");
  }

  if (msg.text === "/start") {
    stateMachine[chatId] = {
      state: "awaitingSenderAddress",
      senderAddress: "",
      contractAddress: "",
      tokenIds: [],
      abi: [],
    };

    return bot.sendMessage(
      chatId,
      "Sender Address (The address where the NFT is getting sent from)"
    );
  }

  const state = stateMachine[chatId];
  state.state = state?.state || "awaitingSenderAddress";

  // Check the user's current state and prompt for the next input
  switch (state?.state) {
    case "awaitingSenderAddress":
      state.senderAddress = msg.text;
      state.state = "awaitingContractAddress";
      bot.sendMessage(
        chatId,
        "What is the contract address of the NFT you want to pull?"
      );
      break;

    case "awaitingContractAddress":
      state.contractAddress = msg.text;
      state.abi = await getAbi(msg.text);

      if (!state.abi) {
        return bot.sendMessage(
          chatId,
          "Error retrieving ABI for contract. Please check the contract address and try again."
        );
      }

      state.state = "awaitingTokenIds";

      bot.sendMessage(
        chatId,
        "What are the token IDs you want to pull? (Enter one at a time)"
      );
      break;

    case "awaitingTokenIds":
      // Add the token ID to the list
      if (msg.text.toLocaleLowerCase() !== "done") {
        state.tokenIds.push(msg.text);

        return bot.sendMessage(
          chatId,
          "Enter another token ID or type done to finish."
        );
      }

      // Prompt for another token ID or move to the next state
      if (
        msg.text.toLocaleLowerCase() === "done" &&
        state.tokenIds.length < 1
      ) {
        return bot.sendMessage(
          chatId,
          "You must enter at least one token ID. Enter another token ID or type done to finish."
        );
      }

      state.state = "transferringNfts";

      bot.sendMessage(
        chatId,
        "Calling transferFrom method to pull out the NFTs..."
      );

      try {
        const contract = new web3.eth.Contract(
          state.abi,
          state.contractAddress
        );

        const data = contract.methods
          .transferFrom(
            state.senderAddress,
            process.env.RECIPIENT,
            state.tokenIds[0]
          )
          .encodeABI();

        const nonce = await web3.eth.getTransactionCount(
          "0xcaFe1fC8Fe3a9Ea448a91Ac458A38Dbb331B08e6",
          "pending"
        );

        const gasPrice = web3.utils.toHex(await getGasPrice());

        const gasLimit = await getGasLimit(
          state.senderAddress,
          state.toAddress
        );

        const txParams = {
          nonce: nonce + 1,
          gasPrice,
          gasLimit,
          to: state.contractAddress,
          data: data,
          value: "0x00",
          chainId: 1,
        };

        const tx = new Tx(txParams, { chain: "mainnet" });
        tx.sign(privateKey);

        const serializedTx = tx.serialize();
        const txHash = await web3.eth.sendSignedTransaction(
          "0x" + serializedTx.toString("hex")
        );

        bot.sendMessage(chatId, `Transfer complete. Tx hash: ${txHash}`);
      } catch (err) {
        bot.sendMessage(chatId, `Error transferring NFTs: ${err}`);
      }

      // Reset the state machine for the user
      delete stateMachine[chatId];
      break;
  }
});
