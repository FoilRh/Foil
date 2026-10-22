// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity 0.8.26;

contract JoinsplitVerifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 16850420781157485788740847127969932176668410047268907933621808274331593267945;
    uint256 constant alphay  = 16896019272436326508576960916370337891960495868550628611745395002390905488246;
    uint256 constant betax1  = 21207669359294286852011553704350875347252994836581272144577977911255861267127;
    uint256 constant betax2  = 5821723095558548729212019219955885299077926737800735703700355214231476444497;
    uint256 constant betay1  = 17229800861886219117224432878752490732297107804400629410287282925132597232914;
    uint256 constant betay2  = 19930123046225376558726879222951519067624664074942923216148027199628237796829;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 1816596734816209322659085737527939662444505028597433466447107296562990678963;
    uint256 constant deltax2 = 18320502044288851190814301604307012029832394507864847597039834447011346124819;
    uint256 constant deltay1 = 16403660675821087212841210469266214559838643217758680803693444626299084393663;
    uint256 constant deltay2 = 7835243725414117645420213039480794613534362992538254487600139566654529133912;

    
    uint256 constant IC0x = 4414363856339338795661374419457386307753429130857814640028663699500651236451;
    uint256 constant IC0y = 5797667670547272254048765223075559906360067976620705562429949358321371718299;
    
    uint256 constant IC1x = 18310680764459385544474025515364675795128295950994362408146719089405510147971;
    uint256 constant IC1y = 17847812620456403901369741427500642284079666276914341283106403135003265356669;
    
    uint256 constant IC2x = 12021930725839107394272575231570571352670099582620046703212158210858862247273;
    uint256 constant IC2y = 11871699942410374661638200544907716877914045067952020019657736758775212188990;
    
    uint256 constant IC3x = 5764682620063948714031593852347287033421126184744438133039036246205000818752;
    uint256 constant IC3y = 21630071641156588923244930528493358402276273655875057458333750706343279716861;
    
    uint256 constant IC4x = 3784464136471571253857158221888486305895376792064620686734139739998787071192;
    uint256 constant IC4y = 16249988642298770552440790857976984944141075074770325724006521697959143593721;
    
    uint256 constant IC5x = 15371540495437985030388535013058045666772046090933328000303436445798027865820;
    uint256 constant IC5y = 14902221185634172969335779519487331010060856274462053593763277193699135501044;
    
    uint256 constant IC6x = 6479415396132408282187805412163169877543364988111075108627295867241155481871;
    uint256 constant IC6y = 1785017591150755560368568374824633806831972981991599399027998349580786304047;
    
    uint256 constant IC7x = 21449865882799376927765205912008925338772268267813069275016694311261039641341;
    uint256 constant IC7y = 7162067597286771215398974353915274123890309899714676382252402328744907855252;
    
    uint256 constant IC8x = 18685014110265188788107832823431127550435130710942063925610719585370088793341;
    uint256 constant IC8y = 17249646300125784871156919064954039681985219596436666465644583295512223578299;
    
    uint256 constant IC9x = 15932418547032612579434173440855537979866273763370067631887691991692230188163;
    uint256 constant IC9y = 9468649810680840867564459958335003904882826430813309112009401805979614154690;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[9] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
