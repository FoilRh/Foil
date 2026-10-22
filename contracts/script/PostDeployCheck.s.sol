// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StashPool} from "../src/StashPool.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {FoilStaking} from "../src/FoilStaking.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {Bonds} from "../src/Bonds.sol";
import {FOIL} from "../src/FOIL.sol";

/// Read-only post-deploy check, driven by deployments/<chainid>.json (or MANIFEST=path).
/// Reverts with "PostDeployCheck: ..." on the first mismatch.
///
///   git checkout <deployed commit> && forge build
///   forge script script/PostDeployCheck.s.sol --rpc-url $RHC_RPC_URL
///
/// Bytecode: live runtime code is compared with out/<File>.sol/<Name>.json
/// deployedBytecode after zeroing the artifact's immutableReferences ranges in the live
/// code (the artifact has zeros there). This is exact for everything except immutables,
/// and the immutables are then checked one by one through their getters against the
/// manifest. A fresh local deployment would not work as a reference: POOL_ID and the
/// EIP-712 caches depend on the deployed address. The build has bytecode_hash = "none",
/// so a comment-only change does not trip the check; any code change does.
/// Poseidon libraries are compared with a local deployment of script/poseidon.json.
///
/// Optional manifest keys: guardian, burnSink, maxDeposit, maxTotal (Deploy.s.sol writes
/// these), operator, work, treasury (add by hand after changing them). Without them the
/// Deploy.s.sol defaults are expected; on mainnet (4663) guardian and burnSink are required.
contract PostDeployCheck is Script {
    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant MAINNET = 4663;

    struct Ref {
        uint256 length;
        uint256 start;
    }

    string internal j;
    address internal owner;
    address internal safe;
    StashPool internal pool;
    ScreeningGate internal gate;
    FoilStaking internal staking;
    FeeRouter internal router;
    Bonds internal bonds;
    FOIL internal foil;
    address internal usdg;

    function run() external {
        check(vm.envOr("MANIFEST", string.concat("deployments/", vm.toString(block.chainid), ".json")));
    }

    /// @notice Runs every check against the manifest at `path`; reverts on the first mismatch.
    function check(string memory path) public {
        j = vm.readFile(path);
        _eqU(vm.parseJsonUint(j, ".chainId"), block.chainid, "manifest chainId");
        owner = _addr(".owner");
        safe = _addr(".safe");
        pool = StashPool(_addr(".pool"));
        gate = ScreeningGate(_addr(".gate"));
        staking = FoilStaking(_addr(".staking"));
        router = FeeRouter(_addr(".feeRouter"));
        bonds = Bonds(_addr(".bonds"));
        foil = FOIL(_addr(".foil"));
        usdg = _addr(".usdg");

        _code();
        _wiring();
        _roles();
        _limits();
        console.log("PostDeployCheck: all checks passed for chain", block.chainid);
    }

    /// @notice True if `a`'s runtime code equals the artifact's deployedBytecode with the
    /// artifact's immutable ranges masked out of the live code.
    /// @param artifact Path of a Foundry artifact, e.g. out/StashPool.sol/StashPool.json.
    function codeMatches(address a, string memory artifact) public view returns (bool) {
        string memory art = vm.readFile(artifact);
        bytes memory want = vm.parseJsonBytes(art, ".deployedBytecode.object");
        bytes memory got = a.code;
        if (got.length != want.length) return false;
        string memory refs = ".deployedBytecode.immutableReferences";
        if (vm.keyExistsJson(art, refs)) {
            string[] memory ids = vm.parseJsonKeys(art, refs);
            for (uint256 i = 0; i < ids.length; i++) {
                Ref[] memory r = abi.decode(vm.parseJson(art, string.concat(refs, "['", ids[i], "']")), (Ref[]));
                for (uint256 k = 0; k < r.length; k++) {
                    for (uint256 b = r[k].start; b < r[k].start + r[k].length; b++) got[b] = 0;
                }
            }
        }
        return keccak256(got) == keccak256(want);
    }

    // ---------------------------------------------------------------- checks

    function _code() internal {
        string[4] memory opt = [".usdg", ".cardNft", ".ccVault", ".safe"];
        for (uint256 i = 0; i < opt.length; i++) {
            if (vm.keyExistsJson(j, opt[i]) && (i < 3 || block.chainid == MAINNET)) _hasCode(_addr(opt[i]), opt[i]);
        }
        _bytecode(address(pool), "StashPool");
        _bytecode(address(gate), "ScreeningGate");
        _bytecode(address(staking), "FoilStaking");
        _bytecode(address(router), "FeeRouter");
        _bytecode(address(bonds), "Bonds");
        _bytecode(address(foil), "FOIL");
        // The verifiers hold the vkeys as constants, so equal code means equal keys.
        _bytecode(address(pool.joinsplitVerifier()), "JoinsplitVerifier");
        _bytecode(address(pool.tinRequestVerifier()), "TinRequestVerifier");
        _bytecode(address(pool.ppoiVerifier()), "PpoiVerifier");

        string memory pj = vm.readFile("script/poseidon.json");
        _sameCode(_addr(".poseidonT3"), _deploy(vm.parseJsonBytes(pj, ".t3")), "poseidonT3");
        _sameCode(_addr(".poseidonT4"), _deploy(vm.parseJsonBytes(pj, ".t4")), "poseidonT4");
    }

    function _wiring() internal view {
        // Pool immutables (masked out of the bytecode comparison above).
        _eq(address(pool.usdg()), usdg, "pool.usdg");
        _eq(address(pool.gate()), address(gate), "pool.gate");
        _eq(address(pool.poseidonT3()), _addr(".poseidonT3"), "pool.poseidonT3");
        _eq(address(pool.poseidonT4()), _addr(".poseidonT4"), "pool.poseidonT4");
        _eqU(pool.POOL_ID(), uint256(keccak256(abi.encode(block.chainid, address(pool)))) % FIELD, "pool.POOL_ID");
        _eq(pool.feeRouter(), address(router), "pool.feeRouter");
        _eq(address(pool.bonds()), address(bonds), "pool.bonds");
        if (!gate.cleanInbound(address(pool))) revert("PostDeployCheck: gate.cleanInbound(pool) is false");

        _eq(address(staking.foil()), address(foil), "staking.foil");
        _eq(address(staking.usdg()), usdg, "staking.usdg");
        _eq(staking.notifier(), address(router), "staking.notifier");

        _eq(address(router.usdg()), usdg, "router.usdg");
        _eq(router.work(), _addrOr(".work", safe), "router.work");
        _eq(router.treasury(), _addrOr(".treasury", safe), "router.treasury");
        _eq(address(router.staking()), address(staking), "router.staking");
        if (block.chainid == MAINNET) {
            address sink = _addr(".burnSink");
            if (sink == address(0xdEaD)) revert("PostDeployCheck: burnSink is 0xdEaD on mainnet");
        }
        _eq(router.burnSink(), _addrOr(".burnSink", address(0xdEaD)), "router.burnSink");

        _eq(address(bonds.foil()), address(foil), "bonds.foil");
        _eq(address(bonds.pool()), address(pool), "bonds.pool");
        _eq(bonds.treasury(), _addrOr(".treasury", safe), "bonds.treasury");

        _eqU(foil.totalSupply(), 1_000_000_000e18, "foil.totalSupply");
    }

    function _roles() internal view {
        _eq(pool.owner(), owner, "pool.owner");
        _eq(gate.owner(), owner, "gate.owner");
        _eq(staking.owner(), owner, "staking.owner");
        _eq(router.owner(), owner, "router.owner");
        _eq(bonds.owner(), owner, "bonds.owner");

        bool timelock = owner != safe && owner.code.length > 0;
        if (block.chainid == MAINNET && !timelock) revert("PostDeployCheck: mainnet owner is not a timelock");
        if (timelock) {
            _bytecode(owner, "TimelockController");
            TimelockController tl = TimelockController(payable(owner));
            _eqU(tl.getMinDelay(), 24 hours, "timelock minDelay");
            if (!tl.hasRole(tl.PROPOSER_ROLE(), safe)) revert("PostDeployCheck: safe is not a timelock proposer");
            if (!tl.hasRole(tl.EXECUTOR_ROLE(), safe)) revert("PostDeployCheck: safe is not a timelock executor");
            if (tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), safe)) revert("PostDeployCheck: safe is timelock admin");
        } else {
            console.log("PostDeployCheck: owner is not a timelock (testnet default: deployer EOA)", owner);
        }

        address g = pool.guardian();
        if (g == address(0)) revert("PostDeployCheck: guardian is zero");
        if (vm.keyExistsJson(j, ".guardian")) _eq(g, _addr(".guardian"), "pool.guardian");
        else if (block.chainid == MAINNET) revert("PostDeployCheck: manifest has no guardian");
        else console.log("PostDeployCheck: guardian not in manifest; live guardian", g);

        address op = _addrOr(".operator", address(0));
        if (op != address(0) && !pool.operators(op)) revert("PostDeployCheck: manifest operator is not a pool operator");

        console.log("fresh providers", gate.freshProviders().length);
        console.log("depositsPaused", pool.depositsPaused(), "requestsPaused", pool.requestsPaused());
    }

    function _limits() internal view {
        bool live = block.chainid == MAINNET || block.chainid == 46630;
        _eqU(pool.maxDeposit(), _uintOr(".maxDeposit", live ? 1_000e6 : 0), "pool.maxDeposit");
        _eqU(pool.maxTotal(), _uintOr(".maxTotal", live ? 500_000e6 : 0), "pool.maxTotal");
    }

    // ---------------------------------------------------------------- helpers

    function _bytecode(address a, string memory name) internal view {
        _hasCode(a, name);
        if (!codeMatches(a, string.concat("out/", name, ".sol/", name, ".json"))) {
            revert(string.concat("PostDeployCheck: ", name, " bytecode at ", vm.toString(a), " differs from the local build"));
        }
    }

    /// Libraries start with `PUSH20 <own address>` (solc's call protection), so that word
    /// is masked when it holds the library's own address.
    function _sameCode(address live, address local, string memory what) internal view {
        _hasCode(live, what);
        if (keccak256(_unlinked(live)) != keccak256(_unlinked(local))) {
            revert(string.concat("PostDeployCheck: ", what, " bytecode differs from script/poseidon.json"));
        }
    }

    function _unlinked(address a) internal view returns (bytes memory c) {
        c = a.code;
        if (c.length <= 21 || c[0] != 0x73) return c;
        address self;
        assembly ("memory-safe") {
            self := shr(96, mload(add(c, 33)))
        }
        if (self == a) for (uint256 i = 1; i <= 20; i++) c[i] = 0;
    }

    function _hasCode(address a, string memory what) internal view {
        if (a.code.length == 0) revert(string.concat("PostDeployCheck: no code at ", what, " ", vm.toString(a)));
    }

    function _eq(address got, address want, string memory what) internal pure {
        if (got != want) revert(string.concat("PostDeployCheck: ", what, " is ", vm.toString(got), ", expected ", vm.toString(want)));
    }

    function _eqU(uint256 got, uint256 want, string memory what) internal pure {
        if (got != want) revert(string.concat("PostDeployCheck: ", what, " is ", vm.toString(got), ", expected ", vm.toString(want)));
    }

    function _addr(string memory key) internal view returns (address) {
        if (!vm.keyExistsJson(j, key)) revert(string.concat("PostDeployCheck: manifest has no ", key));
        return vm.parseJsonAddress(j, key);
    }

    function _addrOr(string memory key, address dflt) internal view returns (address) {
        return vm.keyExistsJson(j, key) ? vm.parseJsonAddress(j, key) : dflt;
    }

    function _uintOr(string memory key, uint256 dflt) internal view returns (uint256) {
        return vm.keyExistsJson(j, key) ? vm.parseJsonUint(j, key) : dflt;
    }

    /// Local (simulated, never broadcast) deployment used as the Poseidon reference.
    function _deploy(bytes memory code) internal returns (address a) {
        assembly ("memory-safe") {
            a := create(0, add(code, 0x20), mload(code))
        }
        require(a != address(0), "PostDeployCheck: poseidon reference deploy failed");
    }
}
