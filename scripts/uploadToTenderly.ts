
import { expect } from 'chai';
import { deployMockContract, MockContract } from 'ethereum-waffle';
import { utils, Contract, ContractFactory, Signer, Wallet, BigNumber} from 'ethers';
import { ethers, artifacts, tenderly, network } from 'hardhat';
import { Interface } from 'ethers/lib/utils';
import { hrtime } from 'process';

const { getSigners, provider } = ethers;


type DrawSettings  = {
    range : BigNumber
    matchCardinality: BigNumber
    pickCost: BigNumber
    distributions: BigNumber[]
}

let wallet1: any
let ticket:any

async function run(){
    [ wallet1 ] = await getSigners();
    const drawCalculator = await deployDrawCalculator(wallet1)

    let ticketArtifact = await artifacts.readArtifact('ITicket')
    ticket = await deployMockContract(wallet1, ticketArtifact.abi)

    await tenderly.persistArtifacts({
        name: "TsunamiDrawCalculatorHarness",
        address:drawCalculator.address
      });

      await tenderly.persistArtifacts({
        name: "ITicket",
        address:ticket.address
      });


    const params: DrawSettings = {
        matchCardinality: BigNumber.from(5),
        distributions: [ethers.utils.parseEther("0.6"),
                    ethers.utils.parseEther("0.1"),
                    ethers.utils.parseEther("0.1"),
                    ethers.utils.parseEther("0.1")
                ],
        range: BigNumber.from(5),
        pickCost: BigNumber.from(utils.parseEther("1")),
    }
    // console.log("setDrawSettings()")


    const drawSettings = {
        distributions: [ethers.utils.parseEther("0.8"), ethers.utils.parseEther("0.2")],
        range: BigNumber.from(10),
        pickCost: BigNumber.from(utils.parseEther("1")),
        matchCardinality: BigNumber.from(8)
    }
    await drawCalculator.initialize(ethers.constants.AddressZero, drawSettings)

    const result = await drawCalculator.connect(wallet1).setDrawSettings(params)
    // expect(result).to.emit(drawCalculator, "DrawSettingsSet")
    


    const winningNumber = utils.solidityKeccak256(["address"], [wallet1.address])
    const winningRandomNumber = utils.solidityKeccak256(["bytes32", "uint256"],[winningNumber, 1])

    const timestamp = 42
    const prizes = [utils.parseEther("100")]
    const encoder = ethers.utils.defaultAbiCoder
    const pickIndices = encoder.encode(["uint256[][]"], [[["1"]]])
    const ticketBalance = utils.parseEther("10")

    await ticket.mock.getBalances.withArgs(wallet1.address, [timestamp]).returns([ticketBalance]) // (user, timestamp): balance
    console.log("calling calculate")
    const result2 = await drawCalculator.calculate(
        wallet1.address,
        [winningRandomNumber],
        [timestamp],
        prizes,
        pickIndices
    )
    // console.log(result2.hash)

}
run()


async function deployDrawCalculator(signer: any): Promise<Contract>{
    const drawCalculatorFactory = await ethers.getContractFactory("TsunamiDrawCalculatorHarness", signer)
    const drawCalculator:Contract = await drawCalculatorFactory.deploy()
    return drawCalculator
}
