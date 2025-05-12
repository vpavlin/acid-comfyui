import fs from "fs";
import path from "path";
import https from "https";
import { Attribute, SigningStargateClient } from "@cosmjs/stargate";
import { MsgCreateDeployment } from "@akashnetwork/akash-api/akash/deployment/v1beta3";
import { QueryClientImpl as QueryProviderClient, QueryProviderRequest } from "@akashnetwork/akash-api/akash/provider/v1beta3";
import { QueryBidsRequest, QueryClientImpl as QueryMarketClient, MsgCreateLease, BidID, Bid, QueryBidsResponse } from "@akashnetwork/akash-api/akash/market/v1beta4";
import * as cert from "@akashnetwork/akashjs/build/certificates";
import { getRpc } from "@akashnetwork/akashjs/build/rpc";
import { SDL } from "@akashnetwork/akashjs/build/sdl";
import { getAkashTypeRegistry } from "@akashnetwork/akashjs/build/stargate";
import { CertificatePem } from "@akashnetwork/akashjs/build/certificates/certificate-manager/CertificateManager";
import { certificateManager } from "@akashnetwork/akashjs/build/certificates/certificate-manager";
import { DirectSecp256k1HdWallet, Registry } from "@cosmjs/proto-signing";
import dotenv from "dotenv";

import inquirer from "inquirer";
 
// CLI prompt library

dotenv.config({ path: ".env" });

// In case you want to test on a sandbox environment, uncomment the following line and comment the following line
// const rpcEndpoint = "https://rpc.sandbox-01.aksh.pw";

// Update this with your RPC endpoint
const rpcEndpoint = "https://rpc.akashnet.net:443";

// Update this environment variable with your wallet mnemonic
const mnemonic = process.env.MNEMONIC || "";
if (!mnemonic) {
  throw new Error("MNEMONIC environment variable is not set. Please set the environment variable in the .env file. See .env.sample for more information.");
}

// Update this with your SDL file
const rawSDL = fs.readFileSync(path.resolve(__dirname, "../deploy.yaml"), "utf8");
const certificatePath = path.resolve(__dirname, "./cert.json");

type Deployment = {
  id: {
    owner: string;
    dseq: number;
  };
};

type Lease = {
  id: {
    owner: string;
    dseq: number;
    provider: string;
    gseq: number;
    oseq: number;
  };
};

// you can set this to a specific deployment sequence number to skip the deployment creation
const dseq = 0;

async function loadPrerequisites() {
  const wallet = await walletFromMnemonic(mnemonic);
  const registry = getAkashTypeRegistry();


  const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet, {
    // @ts-ignore
    registry: new Registry(registry)
  });

  const certificate = await loadOrCreateCertificate(wallet, client);
  const sdl = SDL.fromString(rawSDL, "beta3");

  return {
    wallet,
    client,
    certificate,
    sdl
  };
}

// saves the certificate into the fixtures folder
function saveCertificate(certificate: CertificatePem) {
  const json = JSON.stringify(certificate);
  fs.writeFileSync(certificatePath, json);
}

function loadCertificate(path: string): CertificatePem {
  const json = fs.readFileSync(path, "utf8");

  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error(`Could not parse certificate: ${e} `);
  }
}

async function loadOrCreateCertificate(wallet: DirectSecp256k1HdWallet, client: SigningStargateClient) {
  const accounts = await wallet.getAccounts();
  // check to see if we can load the certificate from the fixtures folder

  if (fs.existsSync(certificatePath)) {
    return loadCertificate(certificatePath);
  }

  // if not, create a new one
  const certificate = certificateManager.generatePEM(accounts[0].address);
  const result = await cert.broadcastCertificate(certificate, accounts[0].address, client);

  if (result.code !== undefined && result.code === 0) {
    // save the certificate to the fixtures folder
    saveCertificate(certificate);
    return certificate;
  }

  throw new Error(`Could not create certificate: ${result.rawLog} `);
}

async function walletFromMnemonic(mnemonic: string) {
  try {
    return await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: "akash" });
  } catch (error) {
    console.error('Could not create wallet from mnemonic, have you updated "examples/fixtures/mnemonic.txt?"');
    throw error;
  }
}

async function createDeployment(sdl: SDL, wallet: DirectSecp256k1HdWallet, client: SigningStargateClient) {
  const blockheight = await client.getHeight();
  const groups = sdl.groups();
  const accounts = await wallet.getAccounts();

  if (dseq != 0) {
    console.log("Skipping deployment creation...");
    return {
      id: {
        owner: accounts[0].address,
        dseq: dseq
      },
      groups: groups,
      deposit: {
        denom: "uakt",
        amount: "500000"
      },
      version: await sdl.manifestVersion(),
      depositor: accounts[0].address
    };
  }

  const deployment = {
    id: {
      owner: accounts[0].address,
      dseq: blockheight
    },
    groups: groups,
    deposit: {
      denom: "uakt",
      amount: "500000"
    },
    version: await sdl.manifestVersion(),
    depositor: accounts[0].address
  };

  const fee = {
    amount: [
      {
        denom: "uakt",
        amount: "20000"
      }
    ],
    gas: "800000"
  };

  const msg = {
    typeUrl: "/akash.deployment.v1beta3.MsgCreateDeployment",
    value: MsgCreateDeployment.fromPartial(deployment)
  };

  const tx = await client.signAndBroadcast(accounts[0].address, [msg], fee, "create deployment");

  if (tx.code !== undefined && tx.code === 0) {
    return deployment;
  }

  throw new Error(`Could not create deployment: ${tx.rawLog} `);
}

async function fetchBid(dseq: number, owner: string) {
  const rpc = await getRpc(rpcEndpoint);
  const client = new QueryMarketClient(rpc);
  const request = QueryBidsRequest.fromPartial({
    filters: {
      owner: owner,
      dseq: dseq
    }
  });

  const startTime = Date.now();
  const timeout = 1000 * 60 * 5;

  while (Date.now() - startTime < timeout) {
    console.log("Fetching bids...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    const bids = await client.Bids(request);
    for (const bid of bids.bids) {
        console.log(bid.bid)
        for (const resource of bid.bid?.resourcesOffer || []) {
            console.log(resource)
            console.log("gpu")
            console.log(resource.resources?.gpu)
            for (const attrs of resource.resources?.gpu?.attributes || []) {
                console.log(attrs)
            }
            
        }
    }

    if (bids.bids.length > 0 && bids.bids[0].bid !== undefined) {
      console.log("Bid fetched!");
      return bids.bids[0].bid;
    }

    // wait 1 second before trying again
  }

  throw new Error(`Could not fetch bid for deployment ${dseq}.Timeout reached.`);
}

async function createLease(deployment: Deployment, wallet: DirectSecp256k1HdWallet, client: SigningStargateClient, bidId: BidID): Promise<Lease> {
  const {
    id: { dseq, owner }
  } = deployment;
  const accounts = await wallet.getAccounts();

  if (bidId === undefined) {
    throw new Error("Bid ID is undefined");
  }

  const lease = {
    bidId: bidId
  };

  const fee = {
    amount: [
      {
        denom: "uakt",
        amount: "50000"
      }
    ],
    gas: "2000000"
  };

  const msg = {
    typeUrl: `/${MsgCreateLease.$type}`,
    value: MsgCreateLease.fromPartial(lease)
  };

  const tx = await client.signAndBroadcast(accounts[0].address, [msg], fee, "create lease");

  if (tx.code !== undefined && tx.code === 0) {
    return {
      id: BidID.toJSON(bidId) as {
        owner: string;
        dseq: number;
        provider: string;
        gseq: number;
        oseq: number;
      }
    };
  }

  throw new Error(`Could not create lease: ${tx.rawLog} `);
}

async function queryLeaseStatus(lease: Lease, providerUri: string, certificate: CertificatePem) {
  const id = lease.id;

  if (id === undefined) {
    throw new Error("Lease ID is undefined");
  }

  const leasePath = `/lease/${id.dseq}/${id.gseq}/${id.oseq}/status`;

  const agent = new https.Agent({
    cert: certificate.cert,
    key: certificate.privateKey,
    rejectUnauthorized: false
  });

  const uri = new URL(providerUri);

  return new Promise<{ services: Record<string, { uris: string[] }> }>((resolve, reject) => {
    const req = https.request(
      {
        hostname: uri.hostname,
        port: uri.port,
        path: leasePath,
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        agent: agent
      },
      res => {
        if (res.statusCode !== 200) {
          return reject(`Could not query lease status: ${res.statusCode}`);
        }

        let data = "";

        res.on("data", chunk => (data += chunk));
        res.on("end", () => resolve(JSON.parse(data)));
      }
    );

    req.on("error", reject);
    req.end();
  });
}

async function sendManifest(sdl: SDL, lease: Lease, wallet: DirectSecp256k1HdWallet, certificate: { cert: string; privateKey: string; publicKey: string }):Promise<string> {
  if (lease.id === undefined) {
    throw new Error("Lease ID is undefined");
  }

  const { dseq, provider } = lease.id;
  const rpc = await getRpc(rpcEndpoint);
  const client = new QueryProviderClient(rpc);
  const request = QueryProviderRequest.fromPartial({
    owner: provider
  });

  const tx = await client.Provider(request);

  if (tx.provider === undefined) {
    throw new Error(`Could not find provider ${provider}`);
  }

  const providerInfo = tx.provider;
  const manifest = sdl.manifestSortedJSON();
  const path = `/deployment/${dseq}/manifest`;

  const uri = new URL(providerInfo.hostUri);
  const agent = new https.Agent({
    cert: certificate.cert,
    key: certificate.privateKey,
    rejectUnauthorized: false
  });

  await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: uri.hostname,
        port: uri.port,
        path: path,
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": manifest.length
        },
        agent: agent
      },
      res => {
        res.on("error", reject);

        res.on("data", chunk => {
          console.log("Response:", chunk.toString());
        });

        if (res.statusCode !== 200) {
          return reject(`Could not send manifest: ${res.statusCode}`);
        }

        resolve("ok");
      }
    );

    req.on("error", reject);
    req.write(manifest);
    req.end();
  });

  const startTime = Date.now();
  const timeout = 1000 * 60 * 10;

  while (Date.now() - startTime < timeout) {
    console.log("Waiting for deployment to start...");
    const status = await queryLeaseStatus(lease, providerInfo.hostUri, certificate).catch(err => {
      if (err.includes("Could not query lease status: 404")) {
        return undefined;
      }

      throw err;
    });

    if (status) {
      for (const [name, service] of Object.entries(status.services)) {
        if (service.uris) {
          console.log(`Service ${name} is available at:`, service.uris[0]);
          return service.uris[0];
        }
      }
    }

    // wait 1 second before trying again
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  throw new Error(`Could not start deployment. Timeout reached.`);
}

// CLI prompt for provider selection
async function promptProviderSelection(providers:ProviderList[]) {
    if (providers.length === 0) throw new Error("No providers found");
    
    const choices = providers.map((provider, index) => ({
      name: `${index + 1}. ${provider.provider || provider.address} | ${provider.attributes.map(a => `${a.key}:${a.value}`).join(", ")}`,
      value: provider
    }));
    
    const answer = await inquirer.prompt([{
      type: "list",
      name: "selected",
      message: "Select a provider with GPU resources:",
      choices
    }]);
    
    return answer.selected.bidId;
}

interface ProviderList {
    address: string,
    provider?: string,
    bidId: BidID,
    attributes: Attribute[]
}

async function listProviders(deployment: Deployment, client: SigningStargateClient):Promise<ProviderList[]> {

    const marketClient = new QueryMarketClient(await getRpc(rpcEndpoint));
    const request = QueryBidsRequest.fromPartial({
      filters: { owner: deployment.id.owner, dseq: deployment.id.dseq }
    });
    

    let bids:QueryBidsResponse | undefined = undefined 
    const startTime = Date.now();
    const timeout = 1000 * 60 * 5;
    while (Date.now() - startTime < timeout) {
        console.log("Fetching bids...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        bids = await marketClient.Bids(request);
    
        if (bids.bids.length > 0) {
          console.log("Bid fetched!");
          break
        }
    
        // wait 1 second before trying again
      }
    const providers = [];
    
    for (const bid of bids?.bids || []) {
      if (bid.bid?.bidId?.provider) {
        const providerClient = new QueryProviderClient(await getRpc(rpcEndpoint));
        const providerRequest = QueryProviderRequest.fromPartial({ owner: bid.bid.bidId.provider });
        const providerResponse = await providerClient.Provider(providerRequest);
        
        const gpuAttrs = providerResponse.provider?.attributes?.filter(attr => attr.key.startsWith("gpu.")) || [];

        for (const resource of bid.bid.resourcesOffer) {
            const gpuAttrs = resource.resources?.gpu?.attributes?.filter(attr => attr.key.includes("nvidia")) || [];

            providers.push({
            address: bid.bid.bidId.provider,
            provider: providerResponse.provider?.hostUri,
            bidId: bid.bid.bidId,
            attributes: gpuAttrs
            });
        }
      }
    }
    
    return providers;
  }

async function checkDeployedURL(url: string) {
    let result = ""
    while(true) {
        try {
            const api = "http://" + url + "/api/v1/status"
            console.log("Checking the ComfyUI Shim...", api)
            const resp = await fetch(api)
            if (resp.status != 200) {
                await new Promise(resolve => setTimeout(resolve, 2000))
            }

            const data = await resp.json()
            if (data.messages.length > 0) {
                console.log("ComfyUI Shim is running at http://"+url)
                return
            }
        } catch (e) {
            //console.log(e)
            console.log("Failed to fetch, retrying...")
            await new Promise(resolve => setTimeout(resolve, 2000))
        }
    }
}

async function deploy() {
  const { wallet, client, certificate, sdl } = await loadPrerequisites();

  console.log("Creating deployment...");
  const deployment = await createDeployment(sdl, wallet, client);

  const providers = await listProviders(deployment, client)


// Step 3: Prompt user to select provider
  const selectedBidId = await promptProviderSelection(providers);
  console.log("Creating lease...");
  const lease = await createLease(deployment, wallet, client, selectedBidId);


  console.log("Sending manifest...");
  const url =  await sendManifest(sdl, lease, wallet, certificate);

  return await checkDeployedURL(url)
}

deploy().catch(console.error);