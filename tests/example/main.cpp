#include <cstdio>
#include <cstring>
#include <cstdlib>

#include <zlib.h>

int main() {
    using namespace std;
    int err;

    unsigned char const input[] = "hello, hello!";
    size_t inputSize = strlen(reinterpret_cast<char const*>(input)) + 1;

    unsigned char stage[32] = "";
    size_t stageSize = 32;
    err = compress(stage, &stageSize, input, inputSize);
    if (err != Z_OK) {
        fprintf(stderr, "error: [%d] %s\n", err, "compress");
        exit(1);
    }

    unsigned char output[32] = "garbage";
    size_t outputSize = 32;
    err = uncompress(output, &outputSize, stage, stageSize);
    if (err != Z_OK) {
        fprintf(stderr, "error: [%d] %s\n", err, "uncompress");
        exit(1);
    }

    printf("%s\n", output);
    return 0;
}
