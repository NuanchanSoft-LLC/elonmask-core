import { query, fromHex, toHex } from '@metamask/controller-utils';
import EthQuery from '@metamask/eth-query';
import { BN } from 'ethereumjs-util';
import { when } from 'jest-when';

import { FakeProvider } from '../../../tests/fake-provider';
import fetchBlockFeeHistory from './fetchBlockFeeHistory';

jest.mock('@metamask/controller-utils', () => {
  return {
    ...jest.requireActual('@metamask/controller-utils'),
    __esModule: true,
    query: jest.fn(),
  };
});

const mockedQuery = query as jest.Mock<
  ReturnType<typeof query>,
  Parameters<typeof query>
>;

/**
 * Calls the given function the given number of times, collecting the results from each call.
 *
 * @param n - The number of times you want to call the function.
 * @param fn - The function to call.
 * @returns An array of values gleaned from the results of each call to the function.
 */
function times<T>(n: number, fn: (n: number) => T): T[] {
  const values = [];
  for (let i = 0; i < n; i++) {
    values.push(fn(i));
  }
  return values;
}

describe('fetchBlockFeeHistory', () => {
  const mockEthQuery = new EthQuery(new FakeProvider());
  describe('with a minimal set of arguments', () => {
    const latestBlockNumber = 3;
    const numberOfRequestedBlocks = 3;

    beforeEach(() => {
      when(mockedQuery)
        .calledWith(mockEthQuery, 'blockNumber')
        .mockResolvedValue(new BN(latestBlockNumber));
    });

    it('should return a representation of fee history from the Ethereum network, organized by block rather than type of data', async () => {
      when(mockedQuery)
        .calledWith(mockEthQuery, 'eth_feeHistory', [
          toHex(numberOfRequestedBlocks),
          toHex(latestBlockNumber),
          [],
        ])
        .mockResolvedValue({
          oldestBlock: toHex(1),
          // Note that this array contains 4 items when the request was made for 3. Per
          // <https://github.com/ethereum/go-ethereum/blob/57a3fab8a75eeb9c2f4fab770b73b51b9fe672c5/eth/gasprice/feehistory.go#L191-L192>,
          // baseFeePerGas will always include an extra item which is the calculated base fee for the
          // next (future) block.
          baseFeePerGas: [
            toHex(10_000_000_000),
            toHex(20_000_000_000),
            toHex(30_000_000_000),
            toHex(40_000_000_000),
          ],
          gasUsedRatio: [0.1, 0.2, 0.3],
        });

      const feeHistory = await fetchBlockFeeHistory({
        ethQuery: mockEthQuery,
        numberOfBlocks: numberOfRequestedBlocks,
      });

      expect(feeHistory).toStrictEqual([
        {
          number: fromHex(toHex(1)),
          baseFeePerGas: fromHex(toHex(10_000_000_000)),
          gasUsedRatio: 0.1,
          priorityFeesByPercentile: {},
        },
        {
          number: fromHex(toHex(2)),
          baseFeePerGas: fromHex(toHex(20_000_000_000)),
          gasUsedRatio: 0.2,
          priorityFeesByPercentile: {},
        },
        {
          number: fromHex(toHex(3)),
          baseFeePerGas: fromHex(toHex(30_000_000_000)),
          gasUsedRatio: 0.3,
          priorityFeesByPercentile: {},
        },
      ]);
    });

    it('should be able to handle an "empty" response from eth_feeHistory', async () => {
      when(mockedQuery)
        .calledWith(mockEthQuery, 'eth_feeHistory', [
          toHex(numberOfRequestedBlocks),
          toHex(latestBlockNumber),
          [],
        ])
        .mockResolvedValue({
          oldestBlock: toHex(0),
          baseFeePerGas: [],
          gasUsedRatio: [],
        });

      const feeHistory = await fetchBlockFeeHistory({
        ethQuery: mockEthQuery,
        numberOfBlocks: numberOfRequestedBlocks,
      });

      expect(feeHistory).toStrictEqual([]);
    });

    it('should be able to handle an response with undefined baseFeePerGas from eth_feeHistory', async () => {
      when(mockedQuery)
        .calledWith(mockEthQuery, 'eth_feeHistory', [
          toHex(numberOfRequestedBlocks),
          toHex(latestBlockNumber),
          [],
        ])
        .mockResolvedValue({
          oldestBlock: toHex(0),
          gasUsedRatio: null,
        });

      const feeHistory = await fetchBlockFeeHistory({
        ethQuery: mockEthQuery,
        numberOfBlocks: numberOfRequestedBlocks,
      });

      expect(feeHistory).toStrictEqual([]);
    });
  });

  describe('given a numberOfBlocks that exceeds the max limit that the EVM returns', () => {
    it('divides the number into chunks and calls eth_feeHistory for each chunk', async () => {
      const latestBlockNumber = 2348;
      const numberOfRequestedBlocks = 2348;
      const expectedChunks = [
        { startBlockNumber: 1, endBlockNumber: 1024 },
        { startBlockNumber: 1025, endBlockNumber: 2048 },
        { startBlockNumber: 2049, endBlockNumber: 2348 },
      ];
      const expectedBlocks = times(numberOfRequestedBlocks, (i) => {
        return {
          number: i + 1,
          baseFeePerGas: toHex(1_000_000_000 * (i + 1)),
          gasUsedRatio: (i + 1) / numberOfRequestedBlocks,
        };
      });

      when(mockedQuery)
        .calledWith(mockEthQuery, 'blockNumber')
        .mockResolvedValue(new BN(latestBlockNumber));

      expectedChunks.forEach(({ startBlockNumber, endBlockNumber }) => {
        const baseFeePerGas = expectedBlocks
          .slice(startBlockNumber - 1, endBlockNumber + 1)
          .map((block) => block.baseFeePerGas);
        const gasUsedRatio = expectedBlocks
          .slice(startBlockNumber - 1, endBlockNumber)
          .map((block) => block.gasUsedRatio);

        when(mockedQuery)
          .calledWith(mockEthQuery, 'eth_feeHistory', [
            toHex(endBlockNumber - startBlockNumber + 1),
            toHex(endBlockNumber),
            [],
          ])
          .mockResolvedValue({
            oldestBlock: toHex(startBlockNumber),
            baseFeePerGas,
            gasUsedRatio,
          });
      });

      const feeHistory = await fetchBlockFeeHistory({
        ethQuery: mockEthQuery,
        numberOfBlocks: numberOfRequestedBlocks,
      });

      expect(feeHistory).toStrictEqual(
        expectedBlocks.map((block) => {
          return {
            number: fromHex(toHex(block.number)),
            baseFeePerGas: fromHex(block.baseFeePerGas),
            gasUsedRatio: block.gasUsedRatio,
            priorityFeesByPercentile: {},
          };
        }),
      );
    });
  });

  describe('given an endBlock of a BN', () => {
    it('should pass it to the eth_feeHistory call', async () => {
      const latestBlockNumber = 3;
      const numberOfRequestedBlocks = 3;
      const endBlock = new BN(latestBlockNumber);
      when(mockedQuery)
        .calledWith(mockEthQuery, 'eth_feeHistory', [
          toHex(numberOfRequestedBlocks),
          toHex(endBlock),
          [],
        ])
        .mockResolvedValue({
          oldestBlock: toHex(0),
          baseFeePerGas: [],
          gasUsedRatio: [],
        });

      const feeHistory = await fetchBlockFeeHistory({
        ethQuery: mockEthQuery,
        numberOfBlocks: numberOfRequestedBlocks,
        endBlock,
      });

      expect(feeHistory).toStrictEqual([]);
    });
  });

  describe('given percentiles', () => {
    const latestBlockNumber = 3;
    const numberOfRequestedBlocks = 3;

    beforeEach(() => {
      when(mockedQuery)
        .calledWith(mockEthQuery, 'blockNumber')
        .mockResolvedValue(new BN(latestBlockNumber));
    });

    it('should match each item in the "reward" key from the response to its percentile', async () => {
      when(mockedQuery)
        .calledWith(mockEthQuery, 'eth_feeHistory', [
          toHex(numberOfRequestedBlocks),
          toHex(latestBlockNumber),
          [10, 20, 30],
        ])
        .mockResolvedValue({
          oldestBlock: toHex(1),
          // Note that this array contains 4 items when the request was made for 3. Per
          // <https://github.com/ethereum/go-ethereum/blob/57a3fab8a75eeb9c2f4fab770b73b51b9fe672c5/eth/gasprice/feehistory.go#L191-L192>,
          // baseFeePerGas will always include an extra item which is the calculated base fee for the
          // next (future) block.
          baseFeePerGas: [
            toHex(100_000_000_000),
            toHex(200_000_000_000),
            toHex(300_000_000_000),
            toHex(400_000_000_000),
          ],
          gasUsedRatio: [0.1, 0.2, 0.3],
          reward: [
            [
              toHex(10_000_000_000),
              toHex(15_000_000_000),
              toHex(20_000_000_000),
            ],
            [toHex(0), toHex(10_000_000_000), toHex(15_000_000_000)],
            [
              toHex(20_000_000_000),
              toHex(20_000_000_000),
              toHex(30_000_000_000),
            ],
          ],
        });

      const feeHistory = await fetchBlockFeeHistory({
        ethQuery: mockEthQuery,
        numberOfBlocks: numberOfRequestedBlocks,
        percentiles: [10, 20, 30],
      });

      expect(feeHistory).toStrictEqual([
        {
          number: fromHex(toHex(1)),
          baseFeePerGas: fromHex(toHex(100_000_000_000)),
          gasUsedRatio: 0.1,
          priorityFeesByPercentile: {
            10: fromHex(toHex(10_000_000_000)),
            20: fromHex(toHex(15_000_000_000)),
            30: fromHex(toHex(20_000_000_000)),
          },
        },
        {
          number: fromHex(toHex(2)),
          baseFeePerGas: fromHex(toHex(200_000_000_000)),
          gasUsedRatio: 0.2,
          priorityFeesByPercentile: {
            10: fromHex(toHex(0)),
            20: fromHex(toHex(10_000_000_000)),
            30: fromHex(toHex(15_000_000_000)),
          },
        },
        {
          number: fromHex(toHex(3)),
          baseFeePerGas: fromHex(toHex(300_000_000_000)),
          gasUsedRatio: 0.3,
          priorityFeesByPercentile: {
            10: fromHex(toHex(20_000_000_000)),
            20: fromHex(toHex(20_000_000_000)),
            30: fromHex(toHex(30_000_000_000)),
          },
        },
      ]);
    });

    it('should be able to handle an "empty" response from eth_feeHistory including an empty "reward" array', async () => {
      when(mockedQuery)
        .calledWith(mockEthQuery, 'eth_feeHistory', [
          toHex(numberOfRequestedBlocks),
          toHex(latestBlockNumber),
          [10, 20, 30],
        ])
        .mockResolvedValue({
          oldestBlock: toHex(0),
          baseFeePerGas: [],
          gasUsedRatio: [],
          reward: [],
        });

      const feeHistory = await fetchBlockFeeHistory({
        ethQuery: mockEthQuery,
        numberOfBlocks: numberOfRequestedBlocks,
        percentiles: [10, 20, 30],
      });

      expect(feeHistory).toStrictEqual([]);
    });
  });

  describe('given includeNextBlock = true', () => {
    const latestBlockNumber = 3;
    const numberOfRequestedBlocks = 3;

    it('includes an extra block with an estimated baseFeePerGas', async () => {
      when(mockedQuery)
        .calledWith(mockEthQuery, 'eth_feeHistory', [
          toHex(numberOfRequestedBlocks),
          toHex(latestBlockNumber),
          [],
        ])
        .mockResolvedValue({
          oldestBlock: toHex(1),
          // Note that this array contains 6 items when we requested 5. Per
          // <https://github.com/ethereum/go-ethereum/blob/57a3fab8a75eeb9c2f4fab770b73b51b9fe672c5/eth/gasprice/feehistory.go#L191-L192>,
          // baseFeePerGas will always include an extra item which is the calculated base fee for the
          // next (future) block.
          baseFeePerGas: [
            toHex(10_000_000_000),
            toHex(20_000_000_000),
            toHex(30_000_000_000),
            toHex(40_000_000_000),
          ],
          gasUsedRatio: [0.1, 0.2, 0.3],
        });

      const feeHistory = await fetchBlockFeeHistory({
        ethQuery: mockEthQuery,
        numberOfBlocks: numberOfRequestedBlocks,
        includeNextBlock: true,
      });

      expect(feeHistory).toStrictEqual([
        {
          number: fromHex(toHex(1)),
          baseFeePerGas: fromHex(toHex(10_000_000_000)),
          gasUsedRatio: 0.1,
          priorityFeesByPercentile: {},
        },
        {
          number: fromHex(toHex(2)),
          baseFeePerGas: fromHex(toHex(20_000_000_000)),
          gasUsedRatio: 0.2,
          priorityFeesByPercentile: {},
        },
        {
          number: fromHex(toHex(3)),
          baseFeePerGas: fromHex(toHex(30_000_000_000)),
          gasUsedRatio: 0.3,
          priorityFeesByPercentile: {},
        },
        {
          number: fromHex(toHex(4)),
          baseFeePerGas: fromHex(toHex(40_000_000_000)),
          gasUsedRatio: null,
          priorityFeesByPercentile: null,
        },
      ]);
    });
  });

  describe('given a range which exceeds existing blocks', () => {
    beforeEach(() => {
      jest.resetAllMocks();
    });

    it('should adjust fetched numberOfBlocks', async () => {
      const latestBlockNumber = 1024;
      const numberOfRequestedBlocks = 2048;
      const endBlock = new BN(latestBlockNumber);

      when(mockedQuery)
        .calledWith(mockEthQuery, 'eth_feeHistory', [
          toHex(latestBlockNumber),
          toHex(latestBlockNumber),
          [],
        ])
        .mockResolvedValue({
          oldestBlock: toHex(0),
          baseFeePerGas: [],
          gasUsedRatio: [],
          reward: [],
        });

      await fetchBlockFeeHistory({
        ethQuery: mockEthQuery,
        numberOfBlocks: numberOfRequestedBlocks,
        endBlock,
      });

      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });
  });
});
