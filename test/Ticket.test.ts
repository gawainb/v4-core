import { Signer } from '@ethersproject/abstract-signer';
import { BigNumber } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { deployMockContract, MockContract } from 'ethereum-waffle';
import { utils, Contract, ContractFactory } from 'ethers';
import hre, { ethers } from 'hardhat';

import { increaseTime as increaseTimeHelper } from './helpers/increaseTime';

const newDebug = require('debug')

const debug = newDebug("pt:Ticket.test.ts")

const { constants, getSigners, provider } = ethers;
const { AddressZero } = constants;
const { getBlock } = provider;
const { parseEther: toWei } = utils;

const increaseTime = (time: number) => increaseTimeHelper(provider, time);

type BinarySearchResult = {
  amount: BigNumber;
  timestamp: number;
};

async function printTwabs(ticketContract: Contract, wallet: SignerWithAddress, debugLog: any = debug) {
  const context = await ticketContract.userBalanceWithTwab(wallet.address)
  debugLog(`Twab Context for ${wallet.address}: { balance: ${ethers.utils.formatEther(context.balance)}, nextTwabIndex: ${context.nextTwabIndex}, cardinality: ${context.cardinality}}`)
  const twabs = []
  for (var i = 0; i < context.cardinality - 1; i++) {
    twabs.push(await ticketContract.getTwab(wallet.address, i));
  }
  twabs.forEach((twab, index) => {
    debugLog(`Twab ${index} { amount: ${twab.amount}, timestamp: ${twab.timestamp}}`)
  })
}

describe('Ticket', () => {
  let controller: MockContract;
  let ticket: Contract;

  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;

  let isInitializeTest = false;

  const ticketName = 'PoolTogether Dai Ticket';
  const ticketSymbol = 'PcDAI';
  const ticketDecimals = 18;

  const initializeTicket = async (
    decimals: number = ticketDecimals,
    controllerAddress: string = controller.address,
  ) => {
    await ticket.initialize(ticketName, ticketSymbol, decimals, controllerAddress);
  };

  beforeEach(async () => {
    [wallet1, wallet2] = await getSigners();

    const TokenControllerInterface = await hre.artifacts.readArtifact('contracts/import/token/TokenControllerInterface.sol:TokenControllerInterface');
    controller = await deployMockContract(wallet1 as Signer, TokenControllerInterface.abi);

    await controller.mock.beforeTokenTransfer.returns();

    const ticketFactory: ContractFactory = await ethers.getContractFactory('TicketHarness');
    ticket = await ticketFactory.deploy();

    if (!isInitializeTest) {
      await initializeTicket();
    }
  });

  describe('initialize()', () => {
    before(() => {
      isInitializeTest = true;
    });

    after(() => {
      isInitializeTest = false;
    });

    it('should initialize ticket', async () => {
      await initializeTicket();

      expect(await ticket.name()).to.equal(ticketName);
      expect(await ticket.symbol()).to.equal(ticketSymbol);
      expect(await ticket.decimals()).to.equal(ticketDecimals);
      expect(await ticket.owner()).to.equal(wallet1.address);
    });

    it('should set custom decimals', async () => {
      const ticketDecimals = 8;

      await initializeTicket(ticketDecimals);
      expect(await ticket.decimals()).to.equal(ticketDecimals);
    });

    it('should fail if token decimal is not greater than 0', async () => {
      await expect(initializeTicket(0)).to.be.revertedWith('Ticket/decimals-gt-zero');
    });

    it('should fail if controller address is address 0', async () => {
      await expect(initializeTicket(ticketDecimals, AddressZero)).to.be.revertedWith(
        'Ticket/controller-not-zero-address',
      );
    });
  });

  describe('decimals()', () => {
    it('should return default decimals', async () => {
      expect(await ticket.decimals()).to.equal(18);
    });
  });

  describe('balanceOf()', () => {
    it('should return user balance', async () => {
      const mintBalance = toWei('1000');

      await ticket.mint(wallet1.address, mintBalance);

      expect(await ticket.balanceOf(wallet1.address)).to.equal(mintBalance);
    });
  });

  describe('totalSupply()', () => {
    it('should return total supply of tickets', async () => {
      const mintBalance = toWei('1000');

      await ticket.mint(wallet1.address, mintBalance);
      await ticket.mint(wallet2.address, mintBalance);

      expect(await ticket.totalSupply()).to.equal(mintBalance.mul(2));
    });
  });
  
  describe('flash loan attack', () => {
    let flashTimestamp: number
    let mintTimestamp: number

    beforeEach(async () => {
      await ticket.flashLoan(wallet1.address, toWei('100000'))
      flashTimestamp = (await provider.getBlock('latest')).timestamp
      await increaseTime(10)
      
      await ticket.mint(wallet1.address, toWei('100'))
      mintTimestamp = (await provider.getBlock('latest')).timestamp

      await increaseTime(20)
    })

    it('should not affect getBalanceAt()', async () => {
      expect(await ticket.getBalanceAt(wallet1.address, flashTimestamp - 1)).to.equal(0)
      expect(await ticket.getBalanceAt(wallet1.address, flashTimestamp)).to.equal(0)
      expect(await ticket.getBalanceAt(wallet1.address, flashTimestamp + 1)).to.equal(0)
    })

    it('should not affect getAverageBalanceBetween() for that time', async () => {
      expect(await ticket.getAverageBalanceBetween(wallet1.address, flashTimestamp - 1, flashTimestamp + 1)).to.equal(0)
    })

    it('should not affect subsequent twabs for getAverageBalanceBetween()', async () => {
      expect(await ticket.getAverageBalanceBetween(wallet1.address, mintTimestamp - 11, mintTimestamp + 11)).to.equal(toWei('50'))
    })
  })

  describe('twab lifetime', () => {
    let twabLifetime: number
    const mintBalance = toWei('1000')

    beforeEach(async () => {
      twabLifetime = await ticket.TWAB_EXPIRY()
    })

    it('should expire old twabs and save gas', async () => {
      let quarterOfLifetime = twabLifetime / 4

      await ticket.mint(wallet1.address, mintBalance)

      // now try transfers
      for (var i = 0; i < 8; i++) {
        await increaseTime(quarterOfLifetime)
        await ticket.mint(wallet2.address, mintBalance)
        await ticket.transfer(wallet2.address, toWei('100'))
        await ticket.burn(wallet2.address, mintBalance.div(2))
      }

      await ticket.burn(wallet1.address, await ticket.balanceOf(wallet1.address))
      await ticket.burn(wallet2.address, await ticket.balanceOf(wallet2.address))

      // here we should have looped around.
    })
  })

  describe('_transfer()', () => {
    const mintAmount = toWei('2500');
    const transferAmount = toWei('1000');

    beforeEach(async () => {
      await ticket.mint(wallet1.address, mintAmount);
    });

    it('should transfer tickets from sender to recipient', async () => {
      expect(await ticket.transferTo(wallet1.address, wallet2.address, transferAmount))
        .to.emit(ticket, 'Transfer')
        .withArgs(wallet1.address, wallet2.address, transferAmount);
      
      await increaseTime(10)

      expect(
        await ticket.getBalanceAt(wallet2.address, (await getBlock('latest')).timestamp),
      ).to.equal(transferAmount);

      expect(
        await ticket.getBalanceAt(wallet1.address, (await getBlock('latest')).timestamp),
      ).to.equal(mintAmount.sub(transferAmount));
    });

    it('should fail to transfer tickets if sender address is address zero', async () => {
      await expect(
        ticket.transferTo(AddressZero, wallet2.address, transferAmount),
      ).to.be.revertedWith('ERC20: transfer from the zero address');
    });

    it('should fail to transfer tickets if receiver address is address zero', async () => {
      await expect(
        ticket.transferTo(wallet1.address, AddressZero, transferAmount),
      ).to.be.revertedWith('ERC20: transfer to the zero address');
    });

    it('should fail to transfer tickets if transfer amount exceeds sender balance', async () => {
      const insufficientMintAmount = toWei('5000');

      await expect(
        ticket.transferTo(wallet1.address, wallet2.address, insufficientMintAmount),
      ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
    });
  });

  describe('_mint()', () => {
    const debug = newDebug('pt:Ticket.test.ts:_mint()')
    const mintAmount = toWei('1000');

    it('should mint tickets to user', async () => {
      expect(await ticket.mint(wallet1.address, mintAmount))
        .to.emit(ticket, 'Transfer')
        .withArgs(AddressZero, wallet1.address, mintAmount);

      await increaseTime(10)

      expect(
        await ticket.getBalanceAt(wallet1.address, (await getBlock('latest')).timestamp),
      ).to.equal(mintAmount);

      expect(await ticket.totalSupply()).to.equal(mintAmount);
    });

    it('should fail to mint tickets if user address is address zero', async () => {
      await expect(ticket.mint(AddressZero, mintAmount)).to.be.revertedWith(
        'ERC20: mint to the zero address',
      );
    });

    it('should not record additional twabs when minting twice in the same block', async () => {
      expect(await ticket.mintTwice(wallet1.address, mintAmount))
        .to.emit(ticket, 'Transfer')
        .withArgs(AddressZero, wallet1.address, mintAmount);

      await printTwabs(ticket, wallet1, debug)

      const context = await ticket.userBalanceWithTwab(wallet1.address)

      debug(`Twab Context: `, context)

      expect(context.cardinality).to.equal(2)
      expect(context.nextTwabIndex).to.equal(1)
      expect(await ticket.totalSupply()).to.equal(mintAmount.mul(2));
    })
  });

  describe('_burn()', () => {
    const debug = newDebug('pt:Ticket.test.ts:_burn()')

    const burnAmount = toWei('500');
    const mintAmount = toWei('1500');

    it('should burn tickets from user balance', async () => {
      await ticket.mint(wallet1.address, mintAmount);

      expect(await ticket.burn(wallet1.address, burnAmount))
        .to.emit(ticket, 'Transfer')
        .withArgs(wallet1.address, AddressZero, burnAmount);

      await increaseTime(1)

      expect(
        await ticket.getBalanceAt(wallet1.address, (await getBlock('latest')).timestamp),
      ).to.equal(mintAmount.sub(burnAmount));

      expect(await ticket.totalSupply()).to.equal(mintAmount.sub(burnAmount));
    });

    it('should fail to burn tickets from user balance if user address is address zero', async () => {
      await expect(ticket.burn(AddressZero, mintAmount)).to.be.revertedWith(
        'ERC20: burn from the zero address',
      );
    });

    it('should fail to burn tickets from user balance if burn amount exceeds user balance', async () => {
      const insufficientMintAmount = toWei('250');

      await ticket.mint(wallet1.address, insufficientMintAmount);

      await expect(ticket.burn(wallet1.address, mintAmount)).to.be.revertedWith(
        'ERC20: burn amount exceeds balance',
      );
    });
  });

  describe('getAverageBalanceBetween()', () => {
    const debug = newDebug('pt:Ticket.test.ts:getAverageBalanceBetween()')
    const balanceBefore = toWei('1000');
    let timestamp: number

    beforeEach(async () => {
      await ticket.mint(wallet1.address, balanceBefore);
      timestamp = (await getBlock('latest')).timestamp;
      debug(`minted ${ethers.utils.formatEther(balanceBefore)} @ timestamp ${timestamp}`)
      // console.log(`Minted at time ${timestamp}`)

    });

    it('should return an average of zero for pre-history requests', async () => {
      await printTwabs(ticket, wallet1, debug)
      // console.log(`Test getAverageBalance() : ${timestamp - 100}, ${timestamp - 50}`)
      expect(await ticket.getAverageBalanceBetween(wallet1.address, timestamp - 100, timestamp - 50)).to.equal(toWei('0'));
    });

    it('should not project into the future', async () => {
      // at this time the user has held 1000 tokens for zero seconds
      // console.log(`Test getAverageBalance() : ${timestamp - 50}, ${timestamp + 50}`)
      expect(await ticket.getAverageBalanceBetween(wallet1.address, timestamp - 50, timestamp + 50)).to.equal(toWei('0'))
    })

    it('should return half the minted balance when the duration is centered over first twab', async () => {
      await increaseTime(100);
      // console.log(`Test getAverageBalance() : ${timestamp - 50}, ${timestamp + 50}`)
      expect(await ticket.getAverageBalanceBetween(wallet1.address, timestamp - 50, timestamp + 50)).to.equal(toWei('500'))
    })

    it('should return an accurate average when the range is after the last twab', async () => {
      await increaseTime(100);
      // console.log(`Test getAverageBalance() : ${timestamp + 50}, ${timestamp + 51}`)
      expect(await ticket.getAverageBalanceBetween(wallet1.address, timestamp + 50, timestamp + 51)).to.equal(toWei('1000'))
    })
    
    context('with two twabs', () => {
      const transferAmount = toWei('500');
      let timestamp2: number

      beforeEach(async () => {
        // they've held 1000 for t+100 seconds
        await increaseTime(100);

        debug(`Transferring ${ethers.utils.formatEther(transferAmount)}...`)
        // now transfer out 500
        await ticket.transfer(wallet2.address, transferAmount);
        timestamp2 = (await getBlock('latest')).timestamp;
        debug(`Transferred at time ${timestamp2}`)

        // they've held 500 for t+100+100 seconds
        await increaseTime(100);
      })

      it('should return an average of zero for pre-history requests', async () => {
        await ticket.getAverageBalanceTx(wallet1.address, timestamp - 100, timestamp - 50)

        debug(`Test getAverageBalance() : ${timestamp - 100}, ${timestamp - 50}`)
        expect(await ticket.getAverageBalanceBetween(wallet1.address, timestamp - 100, timestamp - 50)).to.equal(toWei('0'));
      });

      it('should return half the minted balance when the duration is centered over first twab', async () => {
        await printTwabs(ticket, wallet1, debug)
        debug(`Test getAverageBalance() : ${timestamp - 50}, ${timestamp + 50}`)
        expect(await ticket.getAverageBalanceBetween(wallet1.address, timestamp - 50, timestamp + 50)).to.equal(toWei('500'))
      })

      it('should return an accurate average when the range is between twabs', async () => {
        await ticket.getAverageBalanceTx(wallet1.address, timestamp + 50, timestamp + 55)
        debug(`Test getAverageBalance() : ${timestamp + 50}, ${timestamp + 55}`)
        expect(await ticket.getAverageBalanceBetween(wallet1.address, timestamp + 50, timestamp + 55)).to.equal(toWei('1000'))
      })

      it('should return an accurate average when the end is after the last twab', async () => {
        debug(`Test getAverageBalance() : ${timestamp2 - 50}, ${timestamp2 + 50}`)
        expect(await ticket.getAverageBalanceBetween(wallet1.address, timestamp2 - 50, timestamp2 + 50)).to.equal(toWei('750'))
      })

      it('should return an accurate average when the range is after twabs', async () => {
        debug(`Test getAverageBalance() : ${timestamp2 + 50}, ${timestamp2 + 51}`)
        expect(await ticket.getAverageBalanceBetween(wallet1.address, timestamp2 + 50, timestamp2 + 51)).to.equal(toWei('500'))
      })
    })
  })

  describe('getBalance()', () => {
    const balanceBefore = toWei('1000');

    beforeEach(async () => {
      await ticket.mint(wallet1.address, balanceBefore);
    });

    it('should get correct balance after a ticket transfer', async () => {
      const transferAmount = toWei('500');

      await increaseTime(60);

      const timestampBefore = (await getBlock('latest')).timestamp;

      await ticket.transfer(wallet2.address, transferAmount);

      // no-op register for gas usage
      await ticket.getBalanceTx(wallet1.address, timestampBefore)

      expect(await ticket.getBalanceAt(wallet1.address, timestampBefore)).to.equal(balanceBefore);

      const timestampAfter = (await getBlock('latest')).timestamp;

      expect(await ticket.getBalanceAt(wallet1.address, timestampAfter)).to.equal(
        balanceBefore.sub(transferAmount),
      );
    });
  });

  describe('getBalances()', () => {
    it('should get user balances', async () => {
      const mintAmount = toWei('2000');
      const transferAmount = toWei('500');
      
      await ticket.mint(wallet1.address, mintAmount);
      const mintTimestamp = (await getBlock('latest')).timestamp;
      
      await increaseTime(10)
      
      await ticket.transfer(wallet2.address, transferAmount);
      const transferTimestamp = (await getBlock('latest')).timestamp;

      await increaseTime(10)

      const balances = await ticket.getBalancesAt(wallet1.address, [
        mintTimestamp,
        mintTimestamp + 1,
        transferTimestamp + 2,
      ]);

      expect(balances[0]).to.equal(toWei('0'));
      expect(balances[1]).to.equal(mintAmount);
      expect(balances[2]).to.equal(mintAmount.sub(transferAmount));
    });
  });

  describe('getTotalSupply()', () => {
    const debug = newDebug("pt:Ticket.test.ts:getTotalSupply()")

    context('after a mint', () => {
      const mintAmount = toWei('1000');
      let timestamp: number

      beforeEach(async () => {
        await ticket.mint(wallet1.address, mintAmount);
        timestamp = (await getBlock('latest')).timestamp;
      })

      it('should return 0 before the mint', async () => {
        expect(await ticket.getTotalSupply(timestamp - 50)).to.equal(0)
      })

      it('should return 0 at the time of the mint', async () => {
        expect(await ticket.getTotalSupply(timestamp)).to.equal(mintAmount)
      })

      it('should return the value after the timestamp', async () => {
        const twab = await ticket.getTwab(wallet1.address, 0)
        debug(`twab: `, twab)
        debug(`Checking time ${timestamp + 1}`)
        await increaseTime(10)
        expect(await ticket.getTotalSupply(timestamp + 1)).to.equal(mintAmount)
      })
    })
  });

  describe('getTotalSupplies()', () => {
    const debug = newDebug('pt:Ticket.test.ts:getTotalSupplies()')

    it('should get ticket total supplies', async () => {
      const mintAmount = toWei('2000');
      const burnAmount = toWei('500');
      
      await ticket.mint(wallet1.address, mintAmount);
      const mintTimestamp = (await getBlock('latest')).timestamp;
      debug(`mintTimestamp: ${mintTimestamp}`)

      await increaseTime(10)

      await ticket.burn(wallet1.address, burnAmount);
      const burnTimestamp = (await getBlock('latest')).timestamp;
      debug(`burnTimestamp: ${burnTimestamp}`)

      const totalSupplies = await ticket.getTotalSupplies([
        mintTimestamp,
        mintTimestamp + 1,
        burnTimestamp + 1,
      ]);

      expect(totalSupplies[0]).to.equal(toWei('0'));
      expect(totalSupplies[1]).to.equal(mintAmount);
      expect(totalSupplies[2]).to.equal(mintAmount.sub(burnAmount));
    });
  });

  /**
   * Overflow risk.
   * 
   * A user cannot mint or receive more than 2**224 tokens, as that is the numerical limit.
   * 
   * The user's TWAB will always be larger than their balance, as it continually sums (delta time * balance).
   * The user's TWAB will always have an increasing timestamp.
   * 
   * Overflow situations:
   * 
   * 1. The TWAB timestamp overflows.
   * 2. The TWAB amount overflows.
   * 
   * Invariants:
   * 
   * - the newest TWAB timestamp must always be larger than the oldest.
   * - the newest TWAB must always be larger than the oldest one.
   * 
   * 
   * This means we need to *allow* overflow then try to take it into account when calculating.
   * 
   */



  describe.only('TWAB timestamp overflow', () => {
    const debug = newDebug('pt:Ticket.test.ts: timestamp overflow')

    beforeEach(async () => {
      await ticket.setTime(2**32 - 1000) // 1000 from the end
      // setup overflow situation
      await ticket.mint(wallet1.address, toWei('1000')) // 1000 at t-1000
      await ticket.setTime(2**32 - 800)
      await ticket.transfer(wallet2.address, toWei('100')) // 900 at t-800
      await ticket.setTime(2**32 - 600)
      await ticket.transfer(wallet2.address, toWei('100')) // 800 at t-600
      await ticket.setTime(2**32 - 200)
      await ticket.transfer(wallet2.address, toWei('100')) // 700 at t-200
      await ticket.setTime(2**32 + 200)
      await ticket.transfer(wallet2.address, toWei('100')) // 600 at t+200
      await ticket.setTime(2**32 + 400)
      await ticket.transfer(wallet2.address, toWei('100')) // 500 at t+400

      await printTwabs(ticket, wallet1, debug)
    })

    describe('getAverageBalanceBetween()', () => {
      it('should be accurate across the overflow boundary', async () => {
        expect(await ticket.getAverageBalanceBetween(wallet1.address, 2**32 - 400, 2**32 + 400)).to.equal(toWei('700'))
      })
    })

    describe('getBalanceAt()', () => {
      it('should get the balance and handle the overflow', async () => {
        expect(await ticket.getBalanceAt(wallet1.address, 2**32 + 200)).to.equal(toWei('600'))
      })

      it('should get the balance immediately before the overflow', async () => {
        expect(await ticket.getBalanceAt(wallet1.address, 2**32 - 200)).to.equal(toWei('700'))
      })
    })
  })

});
