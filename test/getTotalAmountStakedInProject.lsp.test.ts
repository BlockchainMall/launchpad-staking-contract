import { DateTime } from "luxon";
import sinon, { SinonSandbox } from "sinon";
import { LatticeTokenInstance } from "../types/truffle-contracts";
import {
  LatticeStakingPoolInstance,
  Deposit,
  PoolAdded,
  ProjectAdded,
  ProjectDisabled,
  Withdraw,
} from "../types/truffle-contracts/LatticeStakingPool";

const LatticeToken = artifacts.require("LatticeToken");
const LatticeStakingPool = artifacts.require("LatticeStakingPool");

const epochFromDateTime = (datetime: DateTime) =>
  Math.floor(datetime.toMillis() / 1000);

contract("LatticeStakingPool: getTotalAmountStakedInProject", (accounts) => {
  let stakingContract: LatticeStakingPoolInstance,
    ltxContract: LatticeTokenInstance;

  const getProject = async (projectId: number) => {
    const response = (await stakingContract.projects(projectId)) as any;

    return {
      name: response.name,
      totalAmountStaked: (response.totalAmountStaked as BN).toNumber(),
      numberOfPools: (response.numberOfPools as BN).toNumber(),
      startTimestamp: DateTime.fromMillis(
        (response.startTimestamp as BN).toNumber() * 1000
      ),
      endTimestamp: DateTime.fromMillis(
        (response.endTimestamp as BN).toNumber() * 1000
      ),
    };
  };

  const createProject = async (
    name: string,
    start: DateTime,
    end: DateTime
  ) => {
    const trxResponse = await stakingContract.addProject(
      name,
      epochFromDateTime(start),
      epochFromDateTime(end),
      {
        from: accounts[0],
      }
    );

    const projectId = (await stakingContract.numberOfProjects()).toNumber() - 1;

    return {
      trxResponse,
      response: await getProject(projectId),
    };
  };

  const getStakingPool = async (projectId: number, poolId: number) => {
    const response = (await stakingContract.stakingPoolInfo(
      projectId,
      poolId
    )) as any;

    return {
      maxStakingAmountPerUser: (
        response.maxStakingAmountPerUser as BN
      ).toNumber(),
      totalAmountStaked: (response.totalAmountStaked as BN).toNumber(),
    };
  };

  const createStakingPool = async (
    projectId: number,
    maxStakingAmountPerUser: number
  ) => {
    const trxResponse = await stakingContract.addStakingPool(
      projectId,
      maxStakingAmountPerUser,
      {
        from: accounts[0],
      }
    );

    const poolId =
      (await stakingContract.numberOfPools(projectId)).toNumber() - 1;

    return {
      trxResponse,
      response: await getStakingPool(projectId, poolId),
    };
  };

  const makeDeposit = async (
    projectId: number,
    poolId: number,
    amount: number,
    from: string
  ) => {
    const trxResponse = await stakingContract.deposit(
      projectId,
      poolId,
      amount,
      {
        from,
      }
    );

    const userStakedAmount = (
      await stakingContract.userStakedAmount(projectId, poolId, from)
    ).toNumber();

    const project = await getProject(projectId);
    const pool = await getStakingPool(projectId, poolId);

    return {
      trxResponse,
      userStakedAmount,
      project,
      pool,
    };
  };

  const withdrawFunds = async (
    projectId: number,
    poolId: number,
    from: string
  ) => {
    const trxResponse = await stakingContract.withdraw(projectId, poolId, {
      from,
    });

    const didUserWithdrawFunds = await stakingContract.didUserWithdrawFunds(
      projectId,
      poolId,
      from
    );

    return {
      trxResponse,
      didUserWithdrawFunds,
    };
  };

  const setChainTimestamp = async (timestamp: DateTime) => {
    return await new Promise((rs, rj) => {
      if (
        typeof web3.currentProvider === "object" &&
        web3.currentProvider !== null &&
        web3.currentProvider.send !== undefined
      ) {
        web3.currentProvider.send(
          {
            jsonrpc: "2.0",
            method: "evm_mine",
            id: Date.now(),
            params: [epochFromDateTime(timestamp)],
          },
          (error, res) => (error ? rj(error) : rs(res))
        );
      } else {
        rj(Error("Unable to set chain timestamp"));
      }
    });
  };

  const approveLtx = async (from: string, to: string, amount: number) => {
    await ltxContract.approve(to, amount, { from });
  };

  const transferLtx = async (from: string, to: string, amount: number) => {
    await ltxContract.transfer(to, amount, { from });
  };

  const allowanceLtx = async (from: string, to: string) => {
    return (await ltxContract.allowance(from, to)).toNumber();
  };

  const balanceLtx = async (account: string) => {
    return (await ltxContract.balanceOf(account)).toNumber();
  };

  // Reset contract states
  beforeEach(async () => {
    ltxContract = await LatticeToken.new();
    stakingContract = await LatticeStakingPool.new(ltxContract.address);
  });

  // Time traveling code /*--
  let futureSandbox: SinonSandbox,
    originalTime: DateTime | null = null;

  beforeEach(async () => {
    futureSandbox = sinon.createSandbox();
  });

  afterEach(async () => {
    if (originalTime) {
      futureSandbox.restore();
      originalTime = null;
      await setChainTimestamp(DateTime.now());
    }
  });

  const timeTravel = async (timestamp: DateTime) => {
    originalTime = DateTime.fromJSDate(new Date());
    futureSandbox.restore();
    futureSandbox.stub(DateTime, "now").callsFake(() => {
      if (originalTime) {
        return timestamp.plus(
          DateTime.fromJSDate(new Date()).diff(originalTime)
        );
      } else {
        throw new Error("Unable to produce future date");
      }
    });
    await setChainTimestamp(timestamp);
  };
  // Time traveling code --*/

  let project: Awaited<ReturnType<typeof createProject>>;
  let pools: Awaited<ReturnType<typeof createStakingPool>>[] = [];
  beforeEach(async () => {
    const name = "project-a";
    const now = DateTime.now().plus({ hours: 1 });
    const after = now.plus({ days: 7 });

    project = await createProject(name, now, after);
    for (let i = 0; i < 3; i++) {
      pools.push(await createStakingPool(0, i * 4000 * 1e8));
    }

    await transferLtx(accounts[0], accounts[1], 10000 * 1e8);
    await approveLtx(accounts[1], stakingContract.address, 8000 * 1e8);
  });

  it("Returns correct amount", async () => {
    await timeTravel(DateTime.now().plus({ hours: 2 }));

    await makeDeposit(0, 0, 3000 * 1e8, accounts[1]);

    const totalAmountStaked = (
      await stakingContract.getTotalAmountStakedInProject(0)
    ).toNumber();

    assert.equal(totalAmountStaked, 3000 * 1e8);
  });

  it("Rejects invalid project ID", async () => {
    await timeTravel(DateTime.now().plus({ hours: 2 }));

    await makeDeposit(0, 0, 3000 * 1e8, accounts[1]);

    try {
      await stakingContract.getTotalAmountStakedInProject(1);

      throw new Error("Method should throw");
    } catch (e) {
      if (e instanceof Error) {
        assert.match(
          e.message,
          /getTotalAmountStakedInProject: Invalid project ID/i
        );
      } else {
        throw new Error("Method should throw an Error");
      }
    }
  });
});
