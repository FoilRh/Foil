pragma circom 2.1.9;

include "./lib.circom";

// Tin request (Build §3.2, §3.4): a join-split whose public output is
// `reserved` (tin size + tin fee) for roundId, plus the relayer fee. Also proves
// refundCommit is a well-formed note of `reserved` owned by the requester, so a
// cancelled request can only ever refund to them. tinCommit and cancelHash are
// opaque public inputs bound by the signature (the contract checks them).
template TinRequest(levels) {
    signal input root;
    signal input extDataHash;
    signal input token;
    signal input poolId;
    signal input inNullifier[2];
    signal input changeCommitment;
    signal input reserved;
    signal input fee;
    signal input roundId;
    signal input tinCommit;
    signal input refundCommit;
    signal input cancelHash;

    signal input Ax;
    signal input Ay;
    signal input nk;
    signal input sigS;
    signal input sigR8x;
    signal input sigR8y;
    signal input inAmount[2];
    signal input inRho[2];
    signal input inPathElements[2][levels];
    signal input inPathIndices[2];
    signal input changeAmount;
    signal input changeRho;
    signal input refundRho;

    component key = MasterPublicKey();
    key.Ax <== Ax;
    key.Ay <== Ay;
    key.nk <== nk;

    component ins[2];
    for (var i = 0; i < 2; i++) {
        ins[i] = SpendInput(levels);
        ins[i].token <== token;
        ins[i].poolId <== poolId;
        ins[i].root <== root;
        ins[i].mpk <== key.mpk;
        ins[i].nk <== nk;
        ins[i].amount <== inAmount[i];
        ins[i].rho <== inRho[i];
        for (var j = 0; j < levels; j++) ins[i].pathElements[j] <== inPathElements[i][j];
        ins[i].pathIndices <== inPathIndices[i];
        ins[i].nullifier <== inNullifier[i];
    }

    component sameNullifier = IsEqual();
    sameNullifier.in[0] <== inNullifier[0];
    sameNullifier.in[1] <== inNullifier[1];
    sameNullifier.out === 0;

    component checks[3];
    checks[0] = AmountCheck(); checks[0].amount <== changeAmount;
    checks[1] = AmountCheck(); checks[1].amount <== reserved;
    checks[2] = AmountCheck(); checks[2].amount <== fee;

    inAmount[0] + inAmount[1] === changeAmount + reserved + fee;

    component change = NoteCommitment();
    change.token <== token;
    change.amount <== changeAmount;
    change.mpk <== key.mpk;
    change.rho <== changeRho;
    change.commitment === changeCommitment;

    component refund = NoteCommitment();
    refund.token <== token;
    refund.amount <== reserved;
    refund.mpk <== key.mpk;
    refund.rho <== refundRho;
    refund.commitment === refundCommit;

    component msg = Poseidon(11);
    msg.inputs[0] <== root;
    msg.inputs[1] <== extDataHash;
    msg.inputs[2] <== inNullifier[0];
    msg.inputs[3] <== inNullifier[1];
    msg.inputs[4] <== changeCommitment;
    msg.inputs[5] <== reserved;
    msg.inputs[6] <== fee;
    msg.inputs[7] <== roundId;
    msg.inputs[8] <== tinCommit;
    msg.inputs[9] <== refundCommit;
    msg.inputs[10] <== cancelHash;

    component auth = SpendAuth();
    auth.Ax <== Ax;
    auth.Ay <== Ay;
    auth.S <== sigS;
    auth.R8x <== sigR8x;
    auth.R8y <== sigR8y;
    auth.msg <== msg.out;
}

component main {public [root, extDataHash, token, poolId, inNullifier, changeCommitment, reserved, fee, roundId, tinCommit, refundCommit, cancelHash]} = TinRequest(32);
