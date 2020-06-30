#include <vector>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <random>
#include <chrono>
#include <limits>
#include <thread>
#include <atomic>

#include "sha2.h"

constexpr size_t MAX_RUNS = 10000000;
std::atomic_bool found = false;

struct xorshift32_state {
    uint32_t a;

	xorshift32_state(uint32_t a)
	: a(a)
	{}
};

uint32_t xorshift32(xorshift32_state& state)
{
	uint32_t x = state.a;
	x ^= x << 13;
	x ^= x >> 17;
	x ^= x << 5;
	return state.a = x;
}


template <typename Container>
std::vector<uint8_t> unhex(const Container& v_)
{
    std::vector<uint8_t> ret(v_.size() / 2); 

    for (unsigned i=0; i<ret.size(); ++i) {
        const char p1 = v_[(i<<1)+0];
        const char p2 = v_[(i<<1)+1];
        ret[i] = ((p1 <= '9' ? p1 - '0' : p1 - 'a' + 10) << 4)
               +  (p2 <= '9' ? p2 - '0' : p2 - 'a' + 10);
    }

    return ret;
}

template <typename Container>
std::string hex(const Container& v)
{
    constexpr std::array<std::uint8_t, 16> chars = { 
        '0', '1', '2', '3', '4', '5', '6', '7',                                                    
        '8', '9', 'a', 'b', 'c', 'd', 'e', 'f' 
    };  
 
    std::string ret(v.size()*2, '\0');
    for (unsigned i=0; i<v.size(); ++i) {
        ret[(i<<1)+0] = chars[v[i] >> 4]; 
        ret[(i<<1)+1] = chars[v[i] & 0x0F];
    }   
 
    return ret;
}

void mine(std::random_device & rd, const size_t difficulty, std::vector<uint8_t> prehash)
{
	std::default_random_engine gen(rd());
	std::uniform_int_distribution<uint32_t> dist(0, std::numeric_limits<uint32_t>::max());

    std::vector<std::uint8_t> solhash(32);
	xorshift32_state state(dist(gen));
	// std::cout << state.a << "\n";

	for (size_t i=0; i<MAX_RUNS; ++i) {
        if (i % 0x100 == 0 && found) {
            break;
        }
		xorshift32(state);

        prehash[prehash.size() - 4] = (state.a >> (0))  & 0xff;
        prehash[prehash.size() - 3] = (state.a >> (8))  & 0xff;
        prehash[prehash.size() - 2] = (state.a >> (16)) & 0xff;
        prehash[prehash.size() - 1] = (state.a >> (24)) & 0xff;

        sha256(prehash.data(), prehash.size(), solhash.data());
        sha256(solhash.data(), solhash.size(), solhash.data());
		// std::cout << hex(solhash) << "\n";

        for (size_t d=0; d<difficulty; ++d) {
            if (solhash[d] != 0x00) {
				goto cont;
			}
        }

        std::cout << "FOUND " << hex(std::vector<uint8_t>{
            prehash[prehash.size() - 4],
            prehash[prehash.size() - 3],
            prehash[prehash.size() - 2],
            prehash[prehash.size() - 1]
        }) << "\n";
        // std::cout << "found " << state.a << "\n";
		std::cout << "SOLHASH " << hex(solhash) << "\n";
		std::cout << "PREHASH " << hex(prehash) << "\n";
		// std::cout << i << " runs\n";
        found = true;
        break;
cont:
		continue;
    }
}

int main(int argc, char * argv[]) {
	if (argc < 2) {
		std::cerr << "need preimage\n";
		return EXIT_FAILURE;
	}
	if (argc < 3) {
		std::cerr << "need difficulty\n";
		return EXIT_FAILURE;
	}
	std::vector<uint8_t> preimage = unhex(std::string(argv[1]));
    // std::cout << "PREIMAGE " << hex(preimage) << "\n";

    const size_t difficulty = argv[2][0]-'0';
	// std::cout << "difficulty: " << difficulty << "\n";

    std::vector<std::uint8_t> prehash = preimage;
	prehash.resize(prehash.size() + 4);

	std::random_device rd;
	std::vector<std::thread> thds;
	for (size_t i=0; i<10; ++i) {
		thds.push_back(std::thread(mine,  std::ref(rd), difficulty, prehash));
	}

	for (auto & t : thds) {
		t.join();
	}

    return EXIT_SUCCESS;
}
