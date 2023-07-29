# Redirectory

An Artifactory impostor for Conan that redirects to GitHub.

I run a public Redirectory that you can use to install (and publish) packages
stored as [releases][] on GitHub.
My server runs the code in this project.
You can run your own server if you want.

[releases]: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases


## Consuming

All package references are of the form `${package}/${version}@github/${owner}`
where `package` matches the name of a repository on GitHub, `version` is a tag
in that repository, and `owner` is the owner of that repository.


## Publishing

### Configuration

First, add the Redirectory server you want to publish through.
If you want to use my server, it is `https://conan.jfreeman.dev`.

```
conan remote add redirectory ${url}
```

To publish, you need to authenticate to the server using a [GitHub Personal
Access Token (PAT)][1]. The server won't actually store this token[^1]. It
just echoes the token back to your Conan client, which stores it in your local
cache and includes it with every authenticated request it makes to the server.

[1]: https://github.blog/2022-10-18-introducing-fine-grained-personal-access-tokens-for-github/

[^1]: To keep my costs down, the Redirectory server doesn't store _anything_.

To create a PAT, navigate to your [token settings][2] and click "Generate new
token". Give your token a name, and make sure it has read-write permissions
for "Contents". Copy the token and authenticate to Redirectory:

```
conan user --remote redirectory ${owner} --password ${token}
```

[2]: https://github.com/settings/tokens?type=beta


### Publishing

Redirectory requires an existing release to attach assets. It will not create
a release for you, because that requires choosing a commit to tag.

Navigate to your project page on GitHub. Look in the right sidebar, under the
About section, for the Releases section and click "Create a new release".
The bare minimum you need to is choose a tag, which needs to be your version
string (optionally prefixed with 'v'). GitHub will create the tag if it
doesn't exist. Everything else can be left defaulted.

```
conan export . github/${owner}
conan upload --remote redirectory ${package}/${version}@github/${owner}
```
