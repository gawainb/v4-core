import { expect } from 'chai';
import { deployMockContract, MockContract } from 'ethereum-waffle';
import { utils, Contract, ContractFactory, Signer, Wallet, BigNumber} from 'ethers';
import { ethers, artifacts, tenderly, network } from 'hardhat';
import { Interface } from 'ethers/lib/utils';
import { hrtime } from 'process';


const { getSigners, provider } = ethers;
const { parseEther: toWei } = utils;

type DrawSettings  = {
    range : BigNumber
    matchCardinality: BigNumber
    pickCost: BigNumber
    distributions: BigNumber[]
}

describe('TsunamiDrawCalculator', () => {
    let drawCalculator: Contract; let ticket: MockContract;
    let wallet1: any;
    let wallet2: any;
    let wallet3: any;

    const encoder = ethers.utils.defaultAbiCoder

    async function findWinningNumberForUser(userAddress: string, matchesRequired: number, drawSettings: DrawSettings) {
        console.log(`searching for ${matchesRequired} winning numbers for ${userAddress} with drawSettings ${JSON.stringify(drawSettings)}..`)
        const drawCalculator: Contract = await deployDrawCalculator(wallet1)
        
        let ticketArtifact = await artifacts.readArtifact('ITicket')
        ticket = await deployMockContract(wallet1, ticketArtifact.abi)
        await drawCalculator.initialize(ticket.address, drawSettings)

        const timestamp = 42
        const prizes = [utils.parseEther("1")]
        const pickIndices = encoder.encode(["uint256[][]"], [[["1"]]])
        const ticketBalance = utils.parseEther("10")

        await ticket.mock.getBalances.withArgs(userAddress, [timestamp]).returns([ticketBalance]) // (user, timestamp): balance

        const distributionIndex = drawSettings.matchCardinality.toNumber() - matchesRequired
        if(distributionIndex > drawSettings.distributions.length){
           throw new Error(`There are only ${drawSettings.distributions.length} tiers of prizes`) // there is no "winning number" in this case
        }

        // now calculate the expected prize amount for these settings
        // totalPrize *  (distributions[index]/(range ^ index)) where index = matchCardinality - numberOfMatches
        const numberOfPrizes = Math.pow(drawSettings.range.toNumber(), distributionIndex)
        const valueAtDistributionIndex : BigNumber = drawSettings.distributions[distributionIndex]
        
        const percentageOfPrize: BigNumber= valueAtDistributionIndex.div(numberOfPrizes)
        const expectedPrizeAmount : BigNumber = (prizes[0]).mul(percentageOfPrize as any).div(ethers.constants.WeiPerEther) 

        let winningRandomNumber

        while(true){
            winningRandomNumber = utils.solidityKeccak256(["address"], [ethers.Wallet.createRandom().address])

            const result = await drawCalculator.calculate(
                userAddress,
                [winningRandomNumber],
                [timestamp],
                prizes,
                pickIndices
            )

            if(result.eq(expectedPrizeAmount)){
                console.log("found a winning number!", winningRandomNumber)
                break
            }
        }
    
        return winningRandomNumber
    }

    async function deployDrawCalculator(signer: any): Promise<Contract>{
        const drawCalculatorFactory = await ethers.getContractFactory("TsunamiDrawCalculatorHarness", signer)
        const drawCalculator:Contract = await drawCalculatorFactory.deploy()
        return drawCalculator
    }

    beforeEach(async () =>{
        [ wallet1, wallet2, wallet3 ] = await getSigners();
        drawCalculator = await deployDrawCalculator(wallet1)

        // console.log(network)

        await tenderly.persistArtifacts({
            name: "TsunamiDrawCalculatorHarness",
            address:drawCalculator.address
          });


        let ticketArtifact = await artifacts.readArtifact('ITicket')
        ticket = await deployMockContract(wallet1, ticketArtifact.abi)

        const drawSettings = {
            distributions: [ethers.utils.parseEther("0.8"), ethers.utils.parseEther("0.2")],
            range: BigNumber.from(10),
            pickCost: BigNumber.from(utils.parseEther("1")),
            matchCardinality: BigNumber.from(8)
        }
        await drawCalculator.initialize(ticket.address, drawSettings)

    })

    describe('finding winning random numbers with helper', ()=>{
        it('find 3 winning numbers', async ()=>{
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
            const result = await findWinningNumberForUser(wallet1.address, 3, params)
        })

        it('gas profiles', async ()=>{
            const gasTestFactory = await ethers.getContractFactory("ConsoleTest")
            const consoleTest = await gasTestFactory.deploy()
            await consoleTest.testConsole()
        })
    })

    describe('admin functions', ()=>{
        it('onlyOwner can setPrizeSettings', async ()=>{
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
            const result = await drawCalculator.setDrawSettings(params)
            expect(result).to.emit(drawCalculator, "DrawSettingsSet")
            console.log(result.hash)
            // await tenderly.push()

            await expect(drawCalculator.connect(wallet2).setDrawSettings(params)).to.be.reverted
        })

        it('cannot set over 100pc of prize for distribution', async ()=>{
            const params: DrawSettings = {
                matchCardinality: BigNumber.from(5),
                distributions: [ethers.utils.parseEther("0.9"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1")
                        ],
                range: BigNumber.from(5),
                pickCost: BigNumber.from(utils.parseEther("1")),
            }
            await expect(drawCalculator.setDrawSettings(params)).
                to.be.revertedWith("DrawCalc/distributions-gt-100%")
        })
        
        it('cannot set range over 15', async ()=>{
            const params: DrawSettings = {
                matchCardinality: BigNumber.from(5),
                distributions: [ethers.utils.parseEther("0.9"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1")
                        ],
                range: BigNumber.from(16),
                pickCost: BigNumber.from(utils.parseEther("1")),
            }
            await expect(drawCalculator.setDrawSettings(params)).
                to.be.revertedWith("DrawCalc/range-gt-15")
        })
    })

    describe('getValueAtIndex()', ()=>{
        it('should return the value at 0 index with full range, no bias', async ()=>{
            const result = await drawCalculator.callStatic.getValueAtIndex("63","0","16")
            console.log("getValueAtIndex() gasUsed ", (await drawCalculator.estimateGas.getValueAtIndex("63","0","16")).toString())
            expect(result).to.equal(15)
        })
        it('should return the value at 1 index with full range, no bias', async ()=>{
            const result = await drawCalculator.callStatic.getValueAtIndex("63","1","15")
            expect(result).to.equal(3)
        })
        it('should return the value at 1 index with full range, no bias', async ()=>{
            const result = await drawCalculator.callStatic.getValueAtIndex("64","1","15")
            expect(result).to.equal(4)
        })
        it('should return the value at 0 index with half range', async ()=>{
            const result = await drawCalculator.callStatic.getValueAtIndex("63","0","7")
            expect(result).to.equal(1) // 15 % 7
        })
        it('should return the value at 0 index with 1 range', async ()=>{
            const result = await drawCalculator.callStatic.getValueAtIndex("63","0","1")
            expect(result).to.equal(0) // 15 % 1
        })
        it('should return the value at 0 index with half range', async ()=>{
            const result = await drawCalculator.callStatic.getValueAtIndex("63","0","10")
            expect(result).to.equal(5) // 15 % 10
        })
    })

    describe('calculate()', () => {
        it.only('should calculate and win grand prize', async () => {
            const winningNumber = utils.solidityKeccak256(["address"], [wallet1.address])
            const winningRandomNumber = utils.solidityKeccak256(["bytes32", "uint256"],[winningNumber, 1])
        
            const timestamp = 42
            const prizes = [utils.parseEther("100")]
            const pickIndices = encoder.encode(["uint256[][]"], [[["1"]]])
            const ticketBalance = utils.parseEther("10")

            await ticket.mock.getBalances.withArgs(wallet1.address, [timestamp]).returns([ticketBalance]) // (user, timestamp): balance

            expect(await drawCalculator.calculate(
                wallet1.address,
                [winningRandomNumber],
                [timestamp],
                prizes,
                pickIndices
            )).to.equal(utils.parseEther("80"))
            
            console.log("GasUsed for calculate(): ", (await drawCalculator.estimateGas.calculate(
                wallet1.address,
                [winningRandomNumber],
                [timestamp],
                prizes,
                pickIndices)).toString())
        })

        it('should calculate for multiple picks, first pick grand prize winner, second pick no winnings', async () => {
            //function calculate(address user, uint256[] calldata randomNumbers, uint256[] calldata timestamps, uint256[] calldata prizes, bytes calldata data) external override view returns (uint256){

            const winningNumber = utils.solidityKeccak256(["address"], [wallet1.address])
            const winningRandomNumber = utils.solidityKeccak256(["bytes32", "uint256"],[winningNumber, 1])
            
            const timestamp1 = 42
            const timestamp2 = 51
            const prizes = [utils.parseEther("100"), utils.parseEther("20")]
            const pickIndices = encoder.encode(["uint256[][]"], [[["1"],["2"]]])
            const ticketBalance = utils.parseEther("10")
            const ticketBalance2 = utils.parseEther("10")

            await ticket.mock.getBalances.withArgs(wallet1.address, [timestamp1,timestamp2]).returns([ticketBalance, ticketBalance2]) // (user, timestamp): balance

            expect(await drawCalculator.calculate(
                wallet1.address,
                [winningRandomNumber, winningRandomNumber],
                [timestamp1, timestamp2],
                prizes,
                pickIndices
            )).to.equal(utils.parseEther("80"))

            const twoPicksResult = await drawCalculator.estimateGas.calculate(
                wallet1.address,
                [winningRandomNumber, winningRandomNumber],
                [timestamp1, timestamp2],
                prizes,
                pickIndices)
        
                

            console.log("GasUsed for 2 pick calculate(): ",twoPicksResult.toString())
        
        })

        it('should not have enough funds for a second pick and revert', async () => {
            const winningNumber = utils.solidityKeccak256(["address"], [wallet1.address])
            const winningRandomNumber = utils.solidityKeccak256(["bytes32", "uint256"],[winningNumber, 1])
            
            const timestamp1 = 42
            const timestamp2 = 51
            const prizes = [utils.parseEther("100"), utils.parseEther("20")]
            const pickIndices = encoder.encode(["uint256[][]"], [[["1"],["2"]]])
            const ticketBalance = utils.parseEther("10")
            const ticketBalance2 = utils.parseEther("0.4")

            await ticket.mock.getBalances.withArgs(wallet1.address, [timestamp1,timestamp2]).returns([ticketBalance, ticketBalance2]) // (user, timestamp): balance

            await expect(drawCalculator.calculate(
                wallet1.address,
                [winningRandomNumber, winningRandomNumber],
                [timestamp1, timestamp2],
                prizes,
                pickIndices
            )).to.revertedWith("DrawCalc/insufficient-user-picks")
        
        })

        it('should calculate and win nothing', async () => {
            
            const winningNumber = utils.solidityKeccak256(["address"], [wallet2.address])
            const userRandomNumber = utils.solidityKeccak256(["bytes32", "uint256"],[winningNumber, 1])
            const timestamp = 42
            const prizes = [utils.parseEther("100")]
            const pickIndices = encoder.encode(["uint256[][]"], [[["1"]]])
            const ticketBalance = utils.parseEther("10")

            await ticket.mock.getBalances.withArgs(wallet1.address, [timestamp]).returns([ticketBalance]) // (user, timestamp): balance

            expect(await drawCalculator.calculate(
                wallet1.address,
                [userRandomNumber],
                [timestamp],
                prizes,
                pickIndices
            )).to.equal(utils.parseEther("0"))
        })

        it('increasing the matchCardinality for same user and winning numbers results in less of a prize', async () => {
            
            const timestamp = 42
            const prizes = [utils.parseEther("100")]
            const pickIndices = encoder.encode(["uint256[][]"], [[["1"]]])
            const ticketBalance = utils.parseEther("10")

            await ticket.mock.getBalances.withArgs(wallet1.address, [timestamp]).returns([ticketBalance]) // (user, timestamp): balance
            
            let params: DrawSettings = {
                matchCardinality: BigNumber.from(6),
                distributions: [ethers.utils.parseEther("0.2"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1")
                        ],
                range: BigNumber.from(4),
                pickCost: BigNumber.from(utils.parseEther("1")),
            }
            await drawCalculator.setDrawSettings(params)

            const winningRandomNumber = "0x3fa0adea2a0c897d68abddf4f91167acda84750ee4a68bf438860114c8592b35"
            const resultingPrize = await drawCalculator.calculate(
                wallet1.address,
                [winningRandomNumber],
                [timestamp],
                prizes,
                pickIndices
            )
            expect(resultingPrize).to.equal(ethers.BigNumber.from(utils.parseEther("0.625")))
            // now increase cardinality 
            params = {
                matchCardinality: BigNumber.from(7),
                distributions: [ethers.utils.parseEther("0.2"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1")
                        ],
                range: BigNumber.from(4),
                pickCost: BigNumber.from(utils.parseEther("1")),
            }
            await drawCalculator.setDrawSettings(params)

            const resultingPrize2 = await drawCalculator.calculate(
                wallet1.address,
                [winningRandomNumber],
                [timestamp],
                prizes,
                pickIndices
            )
            expect(resultingPrize2).to.equal(ethers.BigNumber.from(utils.parseEther("0.15625")))
        })

        it('increasing the number range results in lower probability of matches', async () => {
            
            //function calculate(address user, uint256[] calldata winningRandomNumbers, uint256[] calldata timestamps, uint256[] calldata prizes, bytes calldata data)
            const timestamp = 42
            const prizes = [utils.parseEther("100")]
            const pickIndices = encoder.encode(["uint256[][]"], [[["1"]]])
            const ticketBalance = utils.parseEther("10")

            await ticket.mock.getBalances.withArgs(wallet1.address, [timestamp]).returns([ticketBalance]) // (user, timestamp): balance
        
            let params = {
                matchCardinality: BigNumber.from(5),
                distributions: [ethers.utils.parseEther("0.2"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1")
                        ],
                range: BigNumber.from(4),
                pickCost: BigNumber.from(utils.parseEther("1")),
            }
            await drawCalculator.setDrawSettings(params)

            const winningRandomNumber = await findWinningNumberForUser(wallet1.address, 3, params)
            
            const resultingPrize = await drawCalculator.calculate(
                wallet1.address,
                [winningRandomNumber],
                [timestamp],
                prizes,
                pickIndices
            )
            expect(resultingPrize).to.equal(ethers.BigNumber.from(utils.parseEther("0.625"))) // with 3 matches

            // now increase number range 
            params = {
                matchCardinality: BigNumber.from(5),
                distributions: [ethers.utils.parseEther("0.2"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1"),
                            ethers.utils.parseEther("0.1")
                        ],
                range: BigNumber.from(6),
                pickCost: BigNumber.from(utils.parseEther("1")),
            }
            await drawCalculator.setDrawSettings(params)

            const winningRandomNumber2 = await findWinningNumberForUser(wallet1.address, 3, params)

            const resultingPrize2 = await drawCalculator.calculate(
                wallet1.address,
                [winningRandomNumber2],
                [timestamp],
                prizes,
                pickIndices
            )
            expect(resultingPrize2).to.equal(ethers.BigNumber.from(utils.parseEther("0.2777777777777777")))
        })


    });
})
