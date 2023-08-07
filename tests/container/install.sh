#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o xtrace

# Parameters

gcc_version=${GCC_VERSION:-11}
cmake_version=${CMAKE_VERSION:-3.25.1}
cmake_sha256=1c511d09516af493694ed9baf13c55947a36389674d657a2d5e0ccedc6b291d8
conan_version=${CONAN_VERSION:-1.60}

# Do not add a stanza to this script without explaining why it is here.

apt update
# Non-interactively install tzdata.
# https://stackoverflow.com/a/44333806/618906
DEBIAN_FRONTEND=noninteractive apt install --yes --no-install-recommends tzdata
# Iteratively build the list of packages to install so that we can interleave
# the lines with comments explaining their inclusion.
dependencies=''
# - to download CMake
dependencies+=' curl'
# - to build CMake
dependencies+=' libssl-dev'
# - Python headers for Boost.Python
dependencies+=' python3.10-dev'
# - to install Conan
dependencies+=' python3-pip'
# - CMake generators (but not CMake itself)
dependencies+=' make'
# - compilers
dependencies+=" gcc-${gcc_version} g++-${gcc_version}"
apt install --yes ${dependencies}

# Install Node and NPM.
curl -sL https://deb.nodesource.com/setup_20.x | bash
apt install --yes nodejs

# Install the GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
apt update
apt install gh --yes

# Give us nice unversioned aliases for gcc and company.
update-alternatives --install \
  /usr/bin/gcc gcc /usr/bin/gcc-${gcc_version} 100 \
  --slave /usr/bin/g++ g++ /usr/bin/g++-${gcc_version} \
  --slave /usr/bin/gcc-ar gcc-ar /usr/bin/gcc-ar-${gcc_version} \
  --slave /usr/bin/gcc-nm gcc-nm /usr/bin/gcc-nm-${gcc_version} \
  --slave /usr/bin/gcc-ranlib gcc-ranlib /usr/bin/gcc-ranlib-${gcc_version} \
  --slave /usr/bin/gcov gcov /usr/bin/gcov-${gcc_version} \
  --slave /usr/bin/gcov-tool gcov-tool /usr/bin/gcov-dump-${gcc_version} \
  --slave /usr/bin/gcov-dump gcov-dump /usr/bin/gcov-tool-${gcc_version}
update-alternatives --auto gcc

# The package `gcc` depends on the package `cpp`, but the alternative
# `cpp` is a master alternative already, so it must be updated separately.
update-alternatives --install \
  /usr/bin/cpp cpp /usr/bin/cpp-${gcc_version} 100
update-alternatives --auto cpp

# Download and unpack CMake.
cmake_slug="cmake-${cmake_version}"
cmake_archive="${cmake_slug}.tar.gz"
curl --location --remote-name \
  "https://github.com/Kitware/CMake/releases/download/v${cmake_version}/${cmake_archive}"
echo "${cmake_sha256}  ${cmake_archive}" | sha256sum --check
tar -xzf ${cmake_archive}
rm ${cmake_archive}

# Build and install CMake.
cd ${cmake_slug}
./bootstrap --parallel=$(nproc)
make -j $(nproc)
make install
cd ..
rm --recursive --force ${cmake_slug}

# Install Conan and PyTest.
pip3 install conan==${conan_version} pytest cupcake

conan profile new --detect default
conan profile update settings.compiler=gcc default
conan profile update settings.compiler.version=${gcc_version} default
conan profile update settings.compiler.libcxx=libstdc++11 default
conan profile update settings.compiler.cppstd=20 default
conan profile update env.CC=/usr/bin/gcc default
conan profile update env.CXX=/usr/bin/g++ default

conan remote add local http://localhost

conan install zlib/1.2.13@

# Clean up.
apt clean
