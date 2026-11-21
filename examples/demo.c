#include <stdio.h>

int add_all(int a, int b) {
    int sum = a + b;
    return sum;
}

int main(void) {
    int x = 10;
    int y = 25;
    int result = add_all(x, y);
    const char* label = "Result";
    printf("%s: %d\n", label, result);
    return 0;
}
