# Redirectory

> An Artifactory impostor for Conan that redirects to GitHub.

Redirectory is a server for [Conan] packages,
or a [_remote_][remotes] in Conan parlance.
From the perspective of a Conan client,
it is meant to be a drop-in replacement for [Artifactory].

Redirectory works by using GitHub [releases] as free public storage.
Uploading recipes and packages creates releases in a GitHub project
based on the package reference and attaches files as assets[^2].
Every [revision] of a recipe or package gets its own release[^3].
Installing recipes and packages
looks up those releases and downloads their assets.

[^2]: This effectively means that files must be under 2 GB,
which might be a problem for extremely large binary packages,
but even a debug build of Boost clocks in at only 70 MB compressed.

[^3]: If you use Conan with revisions disabled,
then it effectively gives every recipe and package
exactly one revision with ID `0`.

Redirectory packages are clearly identified by their references.
Conan package references have the form `${name}/${version}@${user}/${channel}`.
Redirectory packages always have the user `github`
and are hosted at the GitHub project `${name}` owned by `${channel}`.
For example, the package `cupcake/0.2.0@github/thejohnfreeman`
is hosted at the GitHub project [`thejohnfreeman/cupcake`][1].

In the spirit of [PyPI], [NPM], [crates.io], and [Hackage],
I run a **free public Redirectory server** at https://conan.jfreeman.dev
to let open source developers like myself publish and share packages
without the gatekeeping of [Conan Center][][^5]
but free from the responsibility of operating a package server[^4].

[^4]: If you do not trust my server with your PAT,
I will soon add instructions for how you can run your own Redirectory server
for free on Google Cloud App Engine, just like I do.

[^5]: I love Conan Center,
but I still want a frictionless package registry
like I enjoy in other languages.

> :warning: **NOTE** :warning:
> These instructions have not been written or tested for Conan 2, but I expect them to work much the same.


## Authentication

Both uploading and downloading require the server to
interact with the GitHub API.
Downloading requires only read permissions,
and the server supplies a shared token to serve downloads
by unauthenticated users.
GitHub [rate limits][3] tokens to 5000 requests per hour.
A download of a recipe sends 3 or 4 requests,
depending on whether your client has revisions enabled,
and a download of a package sends an additional 1 or 2.

If you find the server cannot serve your downloads
because the shared token is exhausted,
then you can either wait for its limit to reset
or you can supply your own [GitHub Personal Access Token (PAT)][PAT].
If you never upload packages,
then that token only needs the bare minimum read-only permissions.
If you want to publish packages,
then you _must_ authenticate with that token
and it needs to have write permissions
for the GitHub repositories hosting your releases.

To create a PAT, navigate to your [token settings][2]
and click "Generate new token".
Give your token a name.
If you want to publish packages through Redirectory,
then under "Permissions" -> "Repository permissions",
make sure it has read-write permissions for "Contents"
(which will automatically include read-only permissions for "Metadata").
Otherwise, you can choose a "Public Repositories (read-only)" token
under "Repository access".
You can always change these decisions later by generating a new token
and revoking the old one.


## Configure

First, add the Redirectory server you want to use.
My free public server is https://conan.jfreeman.dev.

```
conan remote add redirectory ${url}
```

Second, you can optionally authenticate to the server using a
[GitHub Personal Access Token (PAT)][PAT]
(see [Authentication](#authentication)).
Redirectory does not store this token[^1].
It just echoes the token back to your Conan client,
which stores it in your local Conan cache
and includes it with every authenticated request it sends to Redirectory.

[^1]: To keep my costs down, the Redirectory server doesn't store _anything_.

Copy the token and authenticate to Redirectory with your GitHub username:

```
conan user --remote redirectory ${owner} --password ${token}
```


## Consume

All package references are of the form `${name}/${version}@github/${channel}`
where `${name}` matches the name of a repository on GitHub,
`${version}` is a tag in that repository,
and `${channel}` is the owner of that repository.

You can search for available package versions:

```
conan search --remote redirectory ${name}
```


## Publish

When you publish a package,
Redirectory will create a tag and a release for you if none exists.
It will add some metadata in an HTML comment
in the description of that release.
It is important that you never tamper with that comment.

To publish a package,
first export it to your local Conan cache
and then upload it to Redirectory.

```
conan export . github/${owner}
conan upload --remote redirectory ${name}/${version}@github/${owner}
```

After publishing a package,
its files will not be immediately available for installation.
You must wait for GitHub to percolate the asset state
across its load balancer.
In my experience, this can take up to 60 seconds.

If you want your package to be [discoverable][4] through `conan search`,
then you'll need to add `redirectory` as a [topic] on your repository.


[topic]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics
[Conan]: https://conan.io/
[Artifactory]: https://jfrog.com/artifactory/
[remotes]: https://docs.conan.io/2/tutorial/conan_repositories/setting_up_conan_remotes.html
[releases]: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
[PAT]: https://github.blog/2022-10-18-introducing-fine-grained-personal-access-tokens-for-github/
[PyPI]: https://pypi.org/
[NPM]: https://www.npmjs.com/
[crates.io]: https://crates.io/
[Hackage]: https://hackage.haskell.org/
[revision]: https://docs.conan.io/1/versioning/revisions.html
[Conan Center]: https://conan.io/center

[1]: https://github.com/thejohnfreeman/cupcake/releases
[2]: https://github.com/settings/tokens?type=beta
[3]: https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limiting
[4]: https://github.com/topics/redirectory
