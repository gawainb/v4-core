import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract, ContractFactory } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
const { getSigners } = ethers;

const DRAW_SAMPLE_CONFIG = {
  timestamp: 1111111111,
  winningRandomNumber: 11111,
};

function newDraw(overrides: any) {
  return {
    drawId: 1,
    timestamp: DRAW_SAMPLE_CONFIG.timestamp,
    winningRandomNumber: DRAW_SAMPLE_CONFIG.winningRandomNumber,
    beaconPeriodStartedAt: 0,
    beaconPeriodSeconds: 1,
    ...overrides
  }
}

describe('DrawHistory', () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let drawHistory: Contract;

  before(async () => {
    [wallet1, wallet2, wallet3] = await getSigners();
  });

  beforeEach(async () => {
    const drawHistoryFactory: ContractFactory = await ethers.getContractFactory(
      'DrawHistoryHarness',
    );

    drawHistory = await drawHistoryFactory.deploy(wallet1.address, 3);
    await drawHistory.setManager(wallet1.address);
  });

  describe('getNewestDraw()', () => {
    it('should error when no draw history', async () => {
      await expect(drawHistory.getNewestDraw()).to.be.revertedWith('DRB/future-draw')
    });

    it('should get the last draw after pushing a draw', async () => {
      await drawHistory.pushDraw(newDraw({ drawId: 1 }))
      const draw = await drawHistory.getNewestDraw();
      expect(draw.drawId).to.equal(1)
      expect(draw.timestamp).to.equal(DRAW_SAMPLE_CONFIG.timestamp)
      expect(draw.winningRandomNumber).to.equal(DRAW_SAMPLE_CONFIG.winningRandomNumber)
    });
  })

  describe('getOldestDraw()', () => {
    it('should yield an empty draw when no history', async () => {
      const draw = await drawHistory.getOldestDraw();
      expect(draw.drawId).to.equal(0)
      expect(draw.timestamp).to.equal(0)
      expect(draw.winningRandomNumber).to.equal(0)
    });

    it('should yield the first draw when only one', async () => {
      await drawHistory.pushDraw(newDraw({ drawId: 2 }))
      const draw = await drawHistory.getOldestDraw();
      expect(draw.drawId).to.equal(2)
    });

    it('should give the first draw when the buffer is not full', async () => {
      await drawHistory.addMultipleDraws(1, 2, DRAW_SAMPLE_CONFIG.timestamp, DRAW_SAMPLE_CONFIG.winningRandomNumber);
      const draw = await drawHistory.getOldestDraw();
      expect(draw.drawId).to.equal(1)
    });

    it('should give the first draw when the buffer is full', async () => {
      await drawHistory.addMultipleDraws(1, 3, DRAW_SAMPLE_CONFIG.timestamp, DRAW_SAMPLE_CONFIG.winningRandomNumber);
      const draw = await drawHistory.getOldestDraw();
      expect(draw.drawId).to.equal(1)
    });

    it('should give the oldest draw when the buffer has wrapped', async () => {
      // buffer can only hold 3, so the oldest should be draw 3
      await drawHistory.addMultipleDraws(1, 5, DRAW_SAMPLE_CONFIG.timestamp, DRAW_SAMPLE_CONFIG.winningRandomNumber);
      const draw = await drawHistory.getOldestDraw();
      expect(draw.drawId).to.equal(3)
    });
  })

  describe('pushDraw()', () => {
    it('should fail to create a new draw when called from non-draw-manager', async () => {
      const drawPrizeWallet2 = drawHistory.connect(wallet2);
      await expect(
        drawPrizeWallet2.pushDraw(newDraw({ drawId: 1 }))
      ).to.be.revertedWith('Manageable/caller-not-manager')
    });

    it('should create a new draw and emit DrawCreated', async () => {
      await expect(
        await drawHistory.pushDraw(newDraw({ drawId: 1 })),
      )
        .to.emit(drawHistory, 'DrawSet')
        .withArgs(
          1,
          [
            DRAW_SAMPLE_CONFIG.winningRandomNumber,
            1,
            DRAW_SAMPLE_CONFIG.timestamp,
            0,
            1
          ]
        );
    });

    it('should create 8 new draws and return valid next draw id', async () => {
      for (let index = 1; index <= 8; index++) {
        await drawHistory.pushDraw(newDraw({ drawId: index }));

        const currentDraw = await drawHistory.getDraw(index);
        expect(currentDraw.winningRandomNumber).to.equal(DRAW_SAMPLE_CONFIG.winningRandomNumber);
      }
    });
  });

  describe('getDraw()', () => {
    it('should read fail when no draw history', async () => {
      await expect(drawHistory.getDraw(0)).to.revertedWith('DRB/future-draw');
    });

    it('should read the recently created draw struct', async () => {
      await drawHistory.pushDraw(newDraw({ drawId: 1 }))
      const draw = await drawHistory.getDraw(1);
      expect(draw.timestamp).to.equal(DRAW_SAMPLE_CONFIG.timestamp);
      expect(draw.winningRandomNumber).to.equal(DRAW_SAMPLE_CONFIG.winningRandomNumber);
      expect(draw.drawId).to.equal(1);
    });
  });

  describe('getDraws()', () => {
    it('should fail to read draws if history is empty', async () => {
      await expect(drawHistory.getDraws([1])).to.revertedWith('DRB/future-draw');
    });

    it('should succesfully read an array of draws', async () => {
      await drawHistory.addMultipleDraws(1, 2, DRAW_SAMPLE_CONFIG.timestamp, DRAW_SAMPLE_CONFIG.winningRandomNumber);
      const draws = await drawHistory.getDraws([1, 2]);

      for (let index = 0; index < draws.length; index++) {
        expect(draws[index].timestamp).to.equal(DRAW_SAMPLE_CONFIG.timestamp);
        expect(draws[index].winningRandomNumber).to.equal(DRAW_SAMPLE_CONFIG.winningRandomNumber);
        expect(draws[index].drawId).to.equal(index + 1);
      }
    });
  });

  describe('getDrawCount()', () => {
    it('should return 0 when no draw history', async () => {
      expect(await drawHistory.getDrawCount()).to.equal(0);
    });

    it('should return 2 if 2 draws have been pushed', async () => {
      await drawHistory.pushDraw(newDraw({ drawId: 1 }));
      await drawHistory.pushDraw(newDraw({ drawId: 2 }));

      expect(await drawHistory.getDrawCount()).to.equal(2);
    });

    it('should return 3 if buffer of cardinality 3 is full', async () => {
      await drawHistory.pushDraw(newDraw({ drawId: 1 }));
      await drawHistory.pushDraw(newDraw({ drawId: 2 }));
      await drawHistory.pushDraw(newDraw({ drawId: 3 }));

      expect(await drawHistory.getDrawCount()).to.equal(3);
    });

    it('should return 3 if ring buffer has wrapped', async () => {
      await drawHistory.pushDraw(newDraw({ drawId: 1 }));
      await drawHistory.pushDraw(newDraw({ drawId: 2 }));
      await drawHistory.pushDraw(newDraw({ drawId: 3 }));
      await drawHistory.pushDraw(newDraw({ drawId: 4 }));

      expect(await drawHistory.getDrawCount()).to.equal(3);
    });
  });

  describe('setDraw()', () => {
    it('should fail to set existing draw as unauthorized account', async () => {
      await drawHistory.pushDraw(newDraw({ drawId: 1 }))
      await expect(drawHistory.connect(wallet3).setDraw(newDraw({ drawId: 1, timestamp: 2, winningRandomNumber: 2 })))
        .to.be.revertedWith('Ownable/caller-not-owner')
    })

    it('should fail to set existing draw as manager ', async () => {
      await drawHistory.setManager(wallet2.address);
      await drawHistory.pushDraw(newDraw({ drawId: 1, timestamp: 1, winningRandomNumber: 1 }));
      await expect(drawHistory.connect(wallet2).setDraw(newDraw({ drawId: 1, timestamp: 2, winningRandomNumber: 2 })))
        .to.be.revertedWith('Ownable/caller-not-owner')
    })

    it('should succeed to set existing draw as owner', async () => {
      await drawHistory.pushDraw(newDraw({ drawId: 1, timestamp: 1, winningRandomNumber: 1 }));
      const draw = newDraw({ drawId: 1, timestamp: DRAW_SAMPLE_CONFIG.timestamp, winningRandomNumber: 2 })
      await expect(drawHistory.setDraw(draw))
        .to.emit(drawHistory, 'DrawSet')
        .withArgs(1, [2, 1, DRAW_SAMPLE_CONFIG.timestamp, 0, 1]);
      });
  });
});
