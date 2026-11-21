#include <iostream>
#include <map>
#include <string>
#include <vector>

int sum_vector(std::vector<int> nums) {
    int total = 0;
    for (int n : nums) {
        total += n;
    }
    return total;
}

int main() {
    std::vector<int> scores = {92, 85, 78, 96};
    std::map<std::string, int> grades;
    grades["Alice"] = 92;
    grades["Bob"] = 85;
    grades["Charlie"] = 96;

    int total = sum_vector(scores);
    std::cout << "Total: " << total << std::endl;
    return 0;
}
