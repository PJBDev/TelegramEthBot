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
const account = web3.eth.accounts.privateKeyToAccount(
  `0x` + `${process.env.CONTRACT_OWNER_PRIVATE_KEY}`
);

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
        for (let i = 0; i < state.tokenIds.length; i++) {
          const contract = new web3.eth.Contract(
            state.abi,
            state.contractAddress
          );

          const recipientAddress = process.env.RECIPIENT;
          const tokenId = state.tokenIds[i];

          const data = contract.methods
            .transferFrom(state.senderAddress, recipientAddress, tokenId)
            .encodeABI();

          const txObject = {
            to: recipientAddress,
            data: data,
            gas: 100000,
            gasPrice: web3.utils.toWei(
              process.env.GWEI_AMOUNT.toString(),
              "gwei"
            ),
          };

          web3.eth.accounts
            .signTransaction(txObject, process.env.CONTRACT_OWNER_PRIVATE_KEY)
            .then(async (signedTx) => {
              try {
                const tx = await web3.eth
                  .sendSignedTransaction(signedTx.rawTransaction)
                  .on("receipt", console.log)
                  .on("error", console.error);

                bot.sendMessage(chatId, `Successfully transferred NFT: ${tx}`);
              } catch (err) {
                bot.sendMessage(chatId, `Error transferring NFT: ${err}`);
              }
            });
        }
      } catch (err) {
        bot.sendMessage(chatId, `Error transferring NFTs: ${err}`);
      }

      // Reset the state machine for the user
      delete stateMachine[chatId];
      break;
  }
});
