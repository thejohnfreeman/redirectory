from conan import ConanFile

class Example(ConanFile):
    requires = ('zlib/1.2.13',)
    settings = ('arch', 'os', 'compiler', 'build_type')
    generators = ('CMakeToolchain', 'CMakeDeps')
